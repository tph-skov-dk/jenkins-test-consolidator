import {
    Build as ParsedBuild,
    Job as ParsedJob,
    parseJobs,
    TestCase,
} from "./parsing.ts";

type Uuid = ReturnType<typeof crypto.randomUUID>;

export type JobInfo = {
    uuid: Uuid;
    relationship: string[];
};

export type Build = {
    job: Uuid;
    iteration: number;
    children: Build[];
    result: "success" | "aborted" | "failed";
    tests: TestCase[];
    timestamp: Date;
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
    job: Uuid,
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

function buildJobTree(
    input: ParsedJob[],
): { jobs: JobInfo[]; builds: Build[] } {
    const jobData = input.map((x) => ({ ...x, uuid: crypto.randomUUID() }));
    const jobs: JobInfo[] = jobData.map((x) => ({
        uuid: x.uuid,
        relationship: x.relationship,
    }));
    const builds: Build[] = [];
    const unpairedBuilds: (ParsedBuild & Build)[] = jobData
        .flatMap(({ uuid, builds }) =>
            Object.entries(builds).map(([iteration, build]) => ({
                iteration: parseInt(iteration),
                job: uuid,
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
            .find((x) => x.uuid === build.job)
            ?.relationship;
        const upstreamJob = findJobWithRelationship(
            jobs,
            build.upstream.project,
        )
            ?.uuid;
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

export function groupBuilds(builds: Build[]): Build[][] {
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

export function buildTree(parsed: ParsedJob[]) {
    const { jobs, builds } = buildJobTree(parsed);
    return { jobs, builds: builds.filter(hasTests) };
}

if (import.meta.main) {
    console.log(buildTree(await parseJobs("home/jenkins", [])));
}
