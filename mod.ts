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

const TestSuccessCase = z.object({
    startTime: z.number(),
    duration: z.number(),
    className: z.string(),
    testName: z.string(),
    skipped: z.boolean(),
    failedSince: z.literal(0),
});

const TestFailureCase = z.object({
    startTime: z.number(),
    duration: z.number(),
    className: z.string(),
    testName: z.string(),
    skipped: z.boolean(),
    failedSince: z.number().gt(0),
    errorStackTrace: z.string(),
    errorDetails: z.string(),
});

const TestCase = TestSuccessCase.or(TestFailureCase);

const Build = z.object({
    startTime: z.number(),
    duration: z.number(),
    cases: z.array(TestCase),
    result: z.literal(["SUCCESS", "ABORTED", "FAILURE"]),
});

const Job = z.object({
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

type Job = {
    relationship: string[];
    configFile: string;
    buildsFolder: string | null;
    triggers: string[][] | null;
};

type JobLeaf = {
    uuid: string;
    name: string;
    configFile: string;
    buildsFolder: string | null;
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
            buildsFolder: root.buildsFolder,
            configFile: root.configFile,
            triggers: root.triggers,
        });
    }
    return ret;
}

async function findJobs(root: string): Promise<Job[]> {
    const jobs = [];
    for await (
        const { path } of fs.walk(root, {
            match: [jobConfigFilesPattern],
            skip: [/jobs\/Discontinued/],
            includeDirs: false,
            includeSymlinks: false,
            includeFiles: true,
        })
    ) {
        const dat = xml.parse(await Deno.readTextFile(path));
        let triggers: string[][] | null = null;
        {
            const parsed = Job.parse(dat);
            triggers = parsed.project
                ?.publishers
                ?.["hudson.plugins.parameterizedtrigger.BuildTrigger"]
                ?.configs[
                    "hudson.plugins.parameterizedtrigger.BuildTriggerConfig"
                ].projects
                ?.split(",")
                ?.map((x) => x.split("/")) ?? null;
        }
        let buildsFolder: string | null = null;
        {
            const parsed = pathTools.parse(path);
            const formatted = pathTools.format({
                dir: parsed.dir,
                name: "builds",
            });
            if (await fs.exists(formatted)) {
                buildsFolder = formatted;
            }
        }

        jobs.push({
            relationship: formatRelationship(root, pathTools.dirname(path)),
            rootFolder: pathTools.dirname(path),
            configFile: path,
            buildsFolder,
            triggers,
        });
    }
    return jobs;
}

export async function buildTree(root: string) {
    if (!root.endsWith("/")) {
        root += "/";
    }
    const x = buildJobTree(await findJobs(root));
    console.dir(x);
}

if (import.meta.main) {
    buildTree("test_input");
}
