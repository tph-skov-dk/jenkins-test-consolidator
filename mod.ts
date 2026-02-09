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
    configFile: string;
    buildsFolder: string | null;
    triggers: string[] | null;
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
        let triggers: string[] | null = null;
        {
            const parsed = Job.parse(dat);
            triggers = parsed.project
                ?.publishers
                ?.["hudson.plugins.parameterizedtrigger.BuildTrigger"]
                ?.configs[
                    "hudson.plugins.parameterizedtrigger.BuildTriggerConfig"
                ].projects
                ?.split(",") ?? null;
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
    const x = await findJobs(root);
    console.log(x);
}

if (import.meta.main) {
    buildTree("test_input");
}
