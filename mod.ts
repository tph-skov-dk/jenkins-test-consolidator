/*
 * note to self:
 * job should have a Build[] field
 * build.xml sometimes has a `hudson.tasks.junit.TestResultAction` field, presumably
 * whenever it's not aborted - however, we might aswell just build our own off of junitResult.xml
 *
 * steps:
 * - build job tree
 * - link child builds based off of start time and duration overlap
 * - ???
 * - rest of the owl
 */

import * as fs from "@std/fs";
import * as pathTools from "@std/path";
import * as z from "zod";
import * as xml from "@libs/xml";

const jobConfigFilesPattern = /jobs\/[^/]+\/config\.xml$/;

const TestBaseCase = z.object({
    duration: z.coerce.number(),
    testName: z.string(),
    skipped: z.coerce.boolean(),
});

const TestSuccessCase = TestBaseCase.extend({
    errorStackTrace: z.undefined(),
    errorDetails: z.undefined(),
});

const TestFailureCase = TestBaseCase.extend({
    errorStackTrace: z.string(),
    errorDetails: z.string(),
});

const TestCase = TestSuccessCase.or(TestFailureCase);

const Suite = z.object({
    duration: z.coerce.number(),
    cases: z.object({ case: z.array(TestCase).or(TestCase) }),
});

const JunitResultXml = z.object({
    result: z.object({
        suites: z.object({ suite: Suite }),
    }),
});

const BuildXml = z.object({
    result: z.literal(["SUCCESS", "ABORTED", "FAILURE"]),
    actions: z.object({
        "hudson.model.CauseAction": z.object({
            causeBag: z.object({
                entry: z.object({
                    "hudson.model.Cause_-UpstreamCause": z.object({
                        upstreamProject: z.string(),
                        upstreamBuild: z.string(),
                    }).optional(),
                }),
            }),
        }),
    }),
});
const BuildFileXml = z.object({
    build: BuildXml,
    "matrix-build": z.undefined(),
}).or(z.object({
    build: z.undefined(),
    "matrix-build": BuildXml,
}));

const ConfigXml = z.object({
    project: z.object({
        publishers: z.object({
            "hudson.plugins.parameterizedtrigger.BuildTrigger": z.object({
                configs: z.object({
                    "hudson.plugins.parameterizedtrigger.BuildTriggerConfig": z
                        .object({
                            projects: z.string(),
                        }),
                }),
            }).nullish(),
        }).nullish(),
    }).nullish(),
});

type TestCase =
    & {
        duration: number;
        testName: string;
        skipped: boolean;
    }
    & (
        { success: true } | {
            success: false;
            error: {
                stackTrace: string;
                details: string;
            };
        }
    );

type Build = {
    result: "SUCCESS" | "ABORTED" | "FAILURE";
    upstream: {
        project: string;
        build: string;
    } | null;
    tests: TestCase[];
};

type Job = {
    relationship: string[];
    configFile: string;
    builds: { [key: string]: Build };
    triggers: string[][];
};

type JobLeaf = {
    uuid: string;
    name: string;
    configFile: string;
    builds: { [key: string]: Build };
    triggers: string[][] | null;
    children: JobLeaf[];
};

function formatRelationship(root: string, path: string): string[] {
    const ret = [];
    const split = path.slice(root.length).split("/");
    for (let i = 0; i < split.length; ++i) {
        if (split[i] !== "jobs") {
            throw new Error(`expected 'jobs', got '${split[i]}'`);
        }
        i += 1;
        ret.push(split[i]);
    }
    return ret;
}

function takeWhere<T>(array: T[], filter: (x: T) => boolean): T[] {
    const ret = [];
    let i = 0;
    while (i < array.length) {
        if (filter(array[i])) {
            ret.push(...array.splice(i, 1));
        } else {
            i += 1;
        }
    }
    return ret;
}

function findParent(
    jobs: JobLeaf[],
    leaf: JobLeaf,
): JobLeaf {
    function findParentInner(
        jobs: JobLeaf[],
        leaf: JobLeaf,
    ): JobLeaf | undefined {
        for (const job of jobs) {
            if (job.children.find((x) => x.uuid === leaf.uuid)) {
                return job;
            }
            const descendant = findParentInner(job.children, leaf);
            if (descendant) {
                return descendant;
            }
        }
        return undefined;
    }
    const parent = findParentInner(jobs, leaf);
    if (!parent) {
        throw new Error(`leaf ${leaf.name} (${leaf.uuid}) has no parent`);
    }
    return parent;
}

function findRelative(
    jobs: JobLeaf[],
    leaf: JobLeaf,
    components: string[],
): JobLeaf {
    const [head, ...rest] = components;
    if (head === "..") {
        return findRelative(jobs, findParent(jobs, leaf), rest);
    }
    const next = leaf.children.find((x) => x.name === head);
    if (!next) {
        throw new Error(
            `got '${head}' in ${components}, but '${head}' not in ${
                leaf.children.map((x) => x.name)
            }`,
        );
    }
    return findRelative(jobs, next, rest);
}

function buildJobTree(jobs: Job[]): JobLeaf[] {
    const ret: JobLeaf[] = [];
    const roots = takeWhere(jobs, (x) => x.relationship.length === 1);
    const rest = jobs;
    for (const root of roots) {
        const children = takeWhere(
            rest,
            (x) => x.relationship[0] === root.relationship[0],
        ).map((x) => {
            x.relationship.shift();
            return x;
        });
        const childrenTree = buildJobTree(children);
        ret.push({
            uuid: crypto.randomUUID(),
            name: root.relationship[0],
            children: childrenTree,
            builds: root.builds,
            configFile: root.configFile,
            triggers: root.triggers,
        });
    }
    return ret;
}

async function findJobs(root: string): Promise<Job[]> {
    const jobs: Job[] = [];
    for await (
        const entry of fs.walk(root, {
            match: [jobConfigFilesPattern],
            skip: [/jobs\/Discontinued/],
            includeDirs: false,
            includeSymlinks: false,
            includeFiles: true,
        })
    ) {
        const parsed = ConfigXml.parse(
            xml.parse(await Deno.readTextFile(entry.path)),
        );
        const triggers = parsed.project
            ?.publishers
            ?.["hudson.plugins.parameterizedtrigger.BuildTrigger"]
            ?.configs[
                "hudson.plugins.parameterizedtrigger.BuildTriggerConfig"
            ].projects
            ?.split(",")
            ?.map((x) => x.split("/")) ?? [];
        const builds: Job["builds"] = {};
        {
            const parsed = pathTools.parse(entry.path);
            const formatted = pathTools.format({
                dir: parsed.dir,
                name: "builds",
            });
            try {
                for await (
                    const entry of fs.walk(formatted, {
                        includeDirs: false,
                        includeSymlinks: false,
                        match: [/build\.xml/],
                    })
                ) {
                    const buildIterationMatch = entry.path.match(
                        /\/(\d+)\/build.xml$/,
                    );
                    if (!buildIterationMatch) {
                        throw new Error(
                            `'${entry.path}' does not follow pattern '/\\d+/build.xml'`,
                        );
                    }
                    const buildIteration = buildIterationMatch[1];
                    console.log(entry.path);
                    const parsed = BuildFileXml.parse(
                        xml.parse(await Deno.readTextFile(entry.path)),
                    );

                    let tests: TestCase[] = [];
                    try {
                        const junitPath = pathTools.join(
                            pathTools.dirname(entry.path),
                            "junitResult.xml",
                        );
                        const parsedJunit = JunitResultXml.parse(
                            xml.parse(await Deno.readTextFile(junitPath)),
                        );
                        console.log(parsedJunit);
                        const cases = [
                            parsedJunit.result.suites.suite.cases.case,
                        ].flat();
                        tests = cases.map(
                            (x): TestCase => {
                                if (x.errorDetails === undefined) {
                                    return {
                                        skipped: x.skipped,
                                        duration: x.duration,
                                        success: true,
                                        testName: x.testName,
                                    };
                                } else {
                                    return {
                                        skipped: x.skipped,
                                        duration: x.duration,
                                        success: false,
                                        testName: x.testName,
                                        error: {
                                            stackTrace: x.errorStackTrace,
                                            details: x.errorDetails,
                                        },
                                    };
                                }
                            },
                        );
                    } catch (err) {
                        if (!(err instanceof Deno.errors.NotFound)) {
                            throw err;
                        }
                    }

                    const build = parsed["build"] ?? parsed["matrix-build"];
                    const cause = build.actions["hudson.model.CauseAction"]
                        .causeBag
                        .entry["hudson.model.Cause_-UpstreamCause"];
                    builds[buildIteration] = {
                        upstream: cause
                            ? {
                                build: cause.upstreamBuild,
                                project: cause.upstreamProject,
                            }
                            : null,
                        result: build.result,
                        tests,
                    };
                }
            } catch (err) {
                if (!(err instanceof Deno.errors.NotFound)) {
                    throw err;
                }
            }
        }

        jobs.push({
            relationship: formatRelationship(
                root,
                pathTools.dirname(entry.path),
            ),
            configFile: entry.path,
            builds,
            triggers,
        });
    }
    return jobs;
}

export async function buildTree(root: string) {
    if (!root.endsWith("/")) {
        root += "/";
    }
    const x = await findJobs(root);
    for (let i = 0; i < x.length; ++i) {
        if (Object.keys(x[i].builds).length === 0) {
            continue;
        }

        if (
            !Object.keys(x[i].builds).some((key) =>
                x[i].builds[key].tests.length !== 0
            )
        ) {
            continue;
        }
        console.dir(x[i].builds);
    }
}

if (import.meta.main) {
    buildTree("test_input");
}
