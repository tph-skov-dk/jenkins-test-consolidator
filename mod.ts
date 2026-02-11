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

const JunitXmlTestBaseCase = z.object({
    duration: z.coerce.number(),
    testName: z.string(),
    skipped: z.coerce.boolean(),
});

const JunitXmlTestSuccessCase = JunitXmlTestBaseCase.extend({
    errorStackTrace: z.undefined(),
    errorDetails: z.undefined(),
});

const JunitXmlTestFailureCase = JunitXmlTestBaseCase.extend({
    errorStackTrace: z.string(),
    errorDetails: z.string(),
});

const JunitXmlTestCase = JunitXmlTestSuccessCase.or(JunitXmlTestFailureCase);

const JunitXmlSuite = z.object({
    duration: z.coerce.number(),
    cases: z.object({
        case: z.array(JunitXmlTestCase).or(
            JunitXmlTestCase.transform((x) => [x]),
        ),
    }),
});

const JunitXmlResult = z.object({
    result: z.object({
        suites: z.object({ suite: JunitXmlSuite }),
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
}).transform((x) => {
    return {
        triggers: x.project
            ?.publishers
            ?.["hudson.plugins.parameterizedtrigger.BuildTrigger"]
            ?.configs["hudson.plugins.parameterizedtrigger.BuildTriggerConfig"]
            .projects.split(",")
            .map((x) => x.split(/[\\/]/)) ?? [],
    };
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
        project: string[];
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

type RootLeaf = {
    root: true;
    children: JobLeaf[];
};

type JobLeaf = {
    root: false;
    uuid: string;
    name: string;
    configFile: string;
    builds: { [key: string]: Build };
    triggers: string[][];
    children: JobLeaf[];
};

type LeafWithChildren = RootLeaf | JobLeaf;

function formatRelationship(root: string, path: string): string[] {
    const ret = [];
    const split = path.slice(root.length).split(/[\\/]/);
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
    root: RootLeaf,
    target: JobLeaf,
): JobLeaf | RootLeaf {
    function inner(
        root: RootLeaf | JobLeaf,
        src: JobLeaf,
    ): JobLeaf | RootLeaf | undefined {
        if (root.children.find((x) => x.uuid === src.uuid)) {
            return root;
        }
        for (const leaf of root.children) {
            const parent = inner(leaf, src);
            if (parent) {
                return parent;
            }
        }
        return undefined;
    }

    const x = inner(root, target);
    if (x === undefined) {
        throw new Error(`${target.name} does not exist`);
    }
    return x;
}

function findRelative(
    root: RootLeaf,
    initial: JobLeaf,
    components: string[],
): JobLeaf {
    function inner(
        root: RootLeaf,
        leaf: RootLeaf | JobLeaf,
        components: string[],
    ): JobLeaf | undefined {
        const [head, ...rest] = components;
        if (head === "..") {
            if (leaf.root) {
                throw new Error(`"..'d" at root level`);
            }
            return inner(root, findParent(root, leaf), rest);
        }
        const next = leaf.children.find((x) => x.name === head);
        if (next === undefined) {
            throw new Error(
                `got '${head}' in [${components}], but '${head}' not in [${
                    leaf.children.map((x) => x.name)
                }]`,
            );
        }
        if (rest.length === 0) {
            return next;
        }
        return inner(root, next, rest);
    }

    const x = inner(root, findParent(root, initial), components);
    if (x === undefined) {
        throw new Error(`${initial.name} does not exist`);
    }
    return x;
}

function absolutePath(
    root: RootLeaf,
    leaf: JobLeaf,
): string[] {
    function inner(
        jobs: JobLeaf[],
        leaf: JobLeaf,
        parents: string[],
    ): string[] | undefined {
        for (const job of jobs) {
            if (job.uuid === leaf.uuid) {
                return [...parents, job.name];
            }
            const descendant = inner(job.children, leaf, [
                ...parents,
                job.name,
            ]);
            if (descendant) {
                return descendant;
            }
        }
        return undefined;
    }
    const path = inner(root.children, leaf, []);

    if (path === undefined) {
        throw new Error(`leaf ${leaf.name} (${leaf.uuid}) could not be found`);
    }
    return path;
}
function resolveTestPaths(root: RootLeaf): RootLeaf {
    function inner(root: RootLeaf, current: JobLeaf): JobLeaf {
        const ret = structuredClone(current);
        for (const buildIteration in ret.builds) {
            const build = ret.builds[buildIteration];
            if (build.upstream === null) {
                continue;
            }
            build.upstream.project = absolutePath(
                root,
                findRelative(
                    root,
                    current,
                    build.upstream.project,
                ),
            );
        }
        return ret;
    }
    return { ...root, children: root.children.map((x) => inner(root, x)) };
}

function buildJobTree(jobs: Job[]): RootLeaf {
    function inner(jobs: Job[]): JobLeaf[] {
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
            const childrenTree = inner(children);
            ret.push({
                root: false,
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
    return { root: true, children: inner(jobs) };
}

function buildIterationFromPath(path: string): string {
    const buildIterationMatch = path.match(
        /[\\/](\d+)[\\/]build.xml$/,
    );
    if (buildIterationMatch === null) {
        throw new Error(
            `'${path}' does not follow pattern '/\\d+/build.xml'`,
        );
    }
    return buildIterationMatch[1];
}

async function testCasesFromJunitXmlPath(
    junitXmlPath: string,
): Promise<TestCase[]> {
    let junitTestCases: (z.infer<typeof JunitXmlTestCase>)[];
    try {
        const junitResult = JunitXmlResult.parse(
            xml.parse(await Deno.readTextFile(junitXmlPath)),
        );
        junitTestCases = junitResult.result.suites.suite.cases.case;
    } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
            throw err;
        }
        return [];
    }

    return junitTestCases.map((testCase): TestCase => {
        if (testCase.errorDetails === undefined) {
            return {
                ...testCase,
                success: true,
            };
        }
        return {
            ...testCase,
            success: false,
            error: {
                stackTrace: testCase.errorStackTrace,
                details: testCase.errorDetails,
            },
        };
    });
}

async function buildFromBuildXmlPath(buildXmlPath: string) {
    const parsed = BuildFileXml.parse(
        xml.parse(await Deno.readTextFile(buildXmlPath)),
    );

    const parsedBuild = parsed["build"] ?? parsed["matrix-build"];
    const cause = parsedBuild.actions["hudson.model.CauseAction"]
        .causeBag
        .entry["hudson.model.Cause_-UpstreamCause"];

    let tests: TestCase[] = [];
    try {
        const junitXmlPath = pathTools.join(
            pathTools.dirname(buildXmlPath),
            "junitResult.xml",
        );
        tests = await testCasesFromJunitXmlPath(junitXmlPath);
    } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
            throw err;
        }
    }

    return {
        iteration: buildIterationFromPath(buildXmlPath),
        build: {
            upstream: cause !== undefined
                ? {
                    build: cause.upstreamBuild,
                    project: cause.upstreamProject.split(/[\\/]/),
                }
                : null,
            result: parsedBuild.result,
            tests,
        },
    };
}

async function jobFromConfigXmlPath(
    root: string,
    configXmlPath: string,
): Promise<Job> {
    const parsed = ConfigXml.parse(
        xml.parse(await Deno.readTextFile(configXmlPath)),
    );
    const builds: Job["builds"] = {};
    for await (
        const { path: buildXmlPath } of fs.walk(
            pathTools.dirname(configXmlPath),
            {
                includeDirs: false,
                includeSymlinks: false,
                match: [/builds[\\/]\d+[\\/]build\.xml$/],
                maxDepth: 3,
            },
        )
    ) {
        const { iteration, build } = await buildFromBuildXmlPath(
            buildXmlPath,
        );
        builds[iteration] = build;
    }

    return {
        relationship: formatRelationship(
            root,
            pathTools.dirname(configXmlPath),
        ),
        configFile: configXmlPath,
        builds,
        triggers: parsed.triggers,
    };
}

async function parseJobs(root: string): Promise<Job[]> {
    const jobs: Job[] = [];
    for await (
        const { path } of fs.walk(root, {
            match: [/jobs[\\/][^\\/]+[\\/]config\.xml$/],
            skip: [/jobs[\\/]Discontinued/],
            includeDirs: false,
            includeSymlinks: false,
            includeFiles: true,
        })
    ) {
        jobs.push(await jobFromConfigXmlPath(root, path));
    }
    return jobs;
}

export async function buildTree(root: string) {
    if (!(root.endsWith("/") || root.endsWith("\\"))) {
        root += "/";
    }
    return resolveTestPaths(buildJobTree(await parseJobs(root)));
}

function debug(children: JobLeaf[]) {
    for (const item of children) {
        if (item.name.startsWith("Labgrid")) {
            for (const x in item.builds) {
                const build = item.builds[x];
                console.log(build.upstream);
            }
        }
        debug(item.children);
    }
}

if (import.meta.main) {
    debug((await buildTree("test_input")).children);
}
