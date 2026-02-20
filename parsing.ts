import * as fs from "@std/fs";
import * as pathTools from "@std/path";
import * as z from "zod";
import * as xml from "@libs/xml";

const StringBool = z.literal(["true", "false"]).transform((x) => x === "true");

const JunitXmlTestBaseCase = z.object({
    duration: z.coerce.number(),
    testName: z.string(),
    skipped: StringBool,
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
                        upstreamBuild: z.coerce.number(),
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

export type TestCase =
    & {
        duration: number;
        testName: string;
    }
    & (
        { result: "success" | "skipped" } | {
            result: "failed";
            error: {
                stackTrace: string;
                details: string;
            };
        }
    );

export type Build = {
    result: "success" | "aborted" | "failed";
    upstream: {
        project: string[];
        iteration: number;
    } | null;
    tests: TestCase[];
};

export type Job = {
    relationship: string[];
    configFile: string;
    builds: { [key: number]: Build };
    triggers: string[][];
};

function buildIterationFromPath(path: string): number {
    const buildIterationMatch = path.match(
        /[\\/](\d+)[\\/]build.xml$/,
    );
    if (buildIterationMatch === null) {
        throw new Error(
            `'${path}' does not follow pattern '/\\d+/build.xml'`,
        );
    }
    return parseInt(buildIterationMatch[1]);
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
        if (testCase.skipped) {
            return {
                ...testCase,
                result: "skipped",
            };
        }
        if (testCase.errorDetails === undefined) {
            return {
                ...testCase,
                result: "success",
            };
        }
        return {
            ...testCase,
            result: "failed",
            error: {
                stackTrace: testCase.errorStackTrace,
                details: testCase.errorDetails,
            },
        };
    });
}

async function buildFromBuildXmlPath(
    buildXmlPath: string,
): Promise<{ iteration: number; build: Build }> {
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

    function standardizeResultFormat(
        result: z.infer<typeof BuildXml>["result"],
    ): Build["result"] {
        switch (result) {
            case "SUCCESS":
                return "success";
            case "ABORTED":
                return "aborted";
            case "FAILURE":
                return "failed";
        }
    }

    return {
        iteration: buildIterationFromPath(buildXmlPath),
        build: {
            upstream: cause !== undefined
                ? {
                    iteration: cause.upstreamBuild,
                    project: cause.upstreamProject.split(/[\\/]/),
                }
                : null,
            result: standardizeResultFormat(parsedBuild.result),
            tests,
        },
    };
}

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

export async function parseJobs(root: string, skip: string[]): Promise<Job[]> {
    if (!(root.endsWith("/") || root.endsWith("\\"))) {
        root += "/";
    }

    const jobs: Job[] = [];
    for await (
        const { path } of fs.walk(root, {
            match: [/jobs[\\/][^\\/]+[\\/]config\.xml$/],
            skip: skip.map((x) => new RegExp(RegExp.escape(x))),
            includeDirs: false,
            includeSymlinks: false,
            includeFiles: true,
        })
    ) {
        jobs.push(await jobFromConfigXmlPath(root, path));
    }
    return jobs;
}
