import { Build as ParsedBuild, Job as ParsedJob, TestCase } from "./parsing.ts";

import { encodeHex } from "@std/encoding";

export type Hash = Awaited<ReturnType<typeof hashRelationship>>;

async function hashRelationship(relationship: Relationship): Promise<string> {
    // i.e. ["SDK-Tests"].join("-") and ["SDK", "Tests"].join("-") both produce "SDK-Tests"
    const magicSeperatorToEnsureNoAccidentalOverlap = "&/(%)¤(#)%(#";
    const asBytes = new TextEncoder().encode(relationship.join(
        magicSeperatorToEnsureNoAccidentalOverlap,
    ));
    return encodeHex(await crypto.subtle.digest("SHA-1", asBytes));
}
export type Relationship = string[];

export type JobInfo = {
    hash: Hash;
    relationship: string[];
};

export type Build = {
    job: Hash;
    iteration: number;
    children: Build[];
    result: "success" | "aborted" | "failed";
    tests: TestCase[];
    timestamp: Date;
    gitOrigin: string | null;
};

function findJobWithRelationship<T extends { relationship: string[] }>(
    jobs: T[],
    relationship: string[],
): T | undefined {
    for (const job of jobs) {
        if (job.relationship.length !== relationship.length) {
            continue;
        }
        const isSame = relationship
            .every((component, i) => component === job.relationship[i]);
        if (isSame) {
            return job;
        }
    }
    return undefined;
}

function findBuild(
    builds: Build[],
    job: Hash,
    iteration: number,
): Build | undefined {
    for (const build of builds) {
        if (build.iteration === iteration && build.job === job) {
            return build;
        }
        const found = findBuild(build.children, job, iteration);
        if (found !== undefined) {
            return found;
        }
    }
    return undefined;
}

async function buildJobTree(
    input: ParsedJob[],
): Promise<{ jobs: JobInfo[]; builds: Build[] }> {
    const jobData = await Promise.all(input.map(async (x) => ({
        ...x,
        hash: await hashRelationship(x.relationship),
    })));
    const jobs: JobInfo[] = jobData.map((x) => ({
        hash: x.hash,
        relationship: x.relationship,
    }));
    const builds: Build[] = [];
    const unpairedBuilds: (ParsedBuild & Build)[] = jobData
        .flatMap(({ hash, builds }) =>
            Object.entries(builds).map(([iteration, build]) => ({
                iteration: parseInt(iteration),
                job: hash,
                children: [],
                ...build,
            }))
        );
    while (true) {
        const build = unpairedBuilds.pop();
        if (build === undefined) {
            break;
        }
        if (!build.upstream) {
            builds.push(build);
            continue;
        }
        const jobName = jobs
            .find((x) => x.hash === build.job)
            ?.relationship;
        const upstreamJob = findJobWithRelationship(
            jobs,
            build.upstream.project,
        )
            ?.hash;
        if (!upstreamJob) {
            console.warn(
                `[a] build '${
                    jobName?.join(".")
                }[${build.iteration}]' relies on non-existant '${
                    build.upstream.project.at(-1)
                }[${build.upstream.iteration}]'`,
            );
            continue;
        }
        {
            const parent = findBuild(
                builds,
                upstreamJob,
                build.upstream.iteration,
            ) ?? findBuild(
                unpairedBuilds,
                upstreamJob,
                build.upstream.iteration,
            );
            if (!parent) {
                console.warn(
                    `build '${
                        jobName?.join(".")
                    }[${build.iteration}]' relies on non-existant '${
                        build.upstream.project.join(".")
                    }[${build.upstream.iteration}]' - skipping`,
                );
                continue;
            }
            parent.children.push(build);
        }
    }
    return { jobs, builds };
}

function hasTests(build: Build): boolean {
    if (build.tests.length > 0) {
        return true;
    }
    return build.children.some(hasTests);
}

function buildGroupComplexity(builds: Build[]): number {
    function buildComplexity(build: Build): number {
        const children = buildGroupComplexity(build.children);
        return build.tests.length + children;
    }
    return builds.map(buildComplexity).reduce((acc, c) => acc + c, 0) *
        builds.length;
}

function sortBuildGroup(groups: Build[][]): Build[][] {
    return groups.sort((lhs, rhs) =>
        buildGroupComplexity(lhs) - buildGroupComplexity(rhs)
    ).reverse();
}

function groupBuilds(builds: Build[]): Build[][] {
    const map = new Map<string, Build[]>();
    for (const build of builds) {
        const collection = map.get(build.job) ?? [];
        collection.push(build);
        map.set(build.job, collection);
    }
    const groups = map
        .values()
        .map((x) =>
            x.toSorted((lhs, rhs) => lhs.iteration - rhs.iteration).toReversed()
        )
        .toArray();
    return sortBuildGroup(groups);
}

export async function buildTree(parsed: ParsedJob[]) {
    const { jobs, builds } = await buildJobTree(parsed);
    return { jobs, builds: groupBuilds(builds.filter(hasTests)) };
}
