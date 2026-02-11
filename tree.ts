import { Build as UpstreamBuild, Job as ParsedJob } from "./parsing.ts";

type Replace<T, K extends keyof T, S> = Omit<T, K> & S;

export type DownstreamBuild = Replace<UpstreamBuild, "upstream", {
    downstream: {
        project: string[];
        iteration: string;
    }[];
}>;

type UnresolvedJob = {
    root: false;
    uuid: string;
    name: string;
    configFile: string;
    builds: { [key: string]: UpstreamBuild };
    triggers: string[][];
    children: UnresolvedJob[];
};

export type Root<T> = {
    root: true;
    children: T[];
};

export type Job = {
    root: false;
    uuid: string;
    name: string;
    configFile: string;
    builds: { [key: string]: DownstreamBuild };
    triggers: string[][];
    children: Job[];
};

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
    root: Root<UnresolvedJob>,
    target: UnresolvedJob,
): UnresolvedJob | Root<UnresolvedJob> {
    function inner(
        root: Root<UnresolvedJob> | UnresolvedJob,
        src: UnresolvedJob,
    ): UnresolvedJob | Root<UnresolvedJob> | undefined {
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
    root: Root<UnresolvedJob>,
    initial: UnresolvedJob,
    components: string[],
): UnresolvedJob {
    function inner(
        root: Root<UnresolvedJob>,
        leaf: Root<UnresolvedJob> | UnresolvedJob,
        components: string[],
    ): UnresolvedJob | undefined {
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

export function findElement(
    root: Root<Job>,
    components: string[],
): Job {
    function inner(
        root: Root<Job>,
        leaf: Root<Job> | Job,
        components: string[],
    ): Job | undefined {
        const [head, ...rest] = components;
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

    const x = inner(root, root, components);
    if (x === undefined) {
        throw new Error(`[${components}] does not exist`);
    }
    return x;
}

function absolutePath(
    root: Root<UnresolvedJob>,
    leaf: UnresolvedJob,
): string[] {
    function inner(
        jobs: UnresolvedJob[],
        leaf: UnresolvedJob,
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
function absoluteTestPaths(
    root: Root<UnresolvedJob>,
): Root<UnresolvedJob> {
    function inner(
        root: Root<UnresolvedJob>,
        current: UnresolvedJob,
    ): UnresolvedJob {
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

function gatherDownStream(
    root: Root<UnresolvedJob>,
    targetPath: string[],
    targetIteration: string,
): DownstreamBuild["downstream"] {
    function cmp(lhs: string[], rhs: string[]): boolean {
        if (lhs.length !== rhs.length) {
            return false;
        }
        for (let i = 0; i < lhs.length; ++i) {
            if (lhs[i] !== rhs[i]) {
                return false;
            }
        }
        return true;
    }
    function inner(
        targetPath: string[],
        targetIteration: string,
        children: UnresolvedJob["children"],
        acc: DownstreamBuild["downstream"],
    ): DownstreamBuild["downstream"] {
        for (const child of children) {
            for (const [iteration, build] of Object.entries(child.builds)) {
                if (!build.upstream) {
                    continue;
                }
                if (build.upstream.iteration !== targetIteration) {
                    continue;
                }
                if (!cmp(build.upstream.project, targetPath)) {
                    continue;
                }

                acc.push({
                    iteration,
                    project: absolutePath(root, child),
                });
            }
            inner(targetPath, targetIteration, child.children, acc);
        }
        return acc;
    }
    const downstreams = inner(targetPath, targetIteration, root.children, []);
    const deduplicated: typeof downstreams = [];
    for (const maybeNewBuild of downstreams) {
        const existing = deduplicated.find((existingBuild) =>
            existingBuild.iteration === maybeNewBuild.iteration &&
            cmp(existingBuild.project, maybeNewBuild.project)
        );
        if (existing === undefined) {
            deduplicated.push(maybeNewBuild);
        }
    }
    return deduplicated;
}

function reverseTestPathDirection(
    root: Root<UnresolvedJob>,
): Root<Job> {
    function inner(
        root: Root<UnresolvedJob>,
        current: UnresolvedJob,
    ): Job {
        const path = absolutePath(root, current);
        const builds: [string, DownstreamBuild][] = Object
            .entries(current.builds)
            .map(([iteration, build]): [string, DownstreamBuild] => {
                return [iteration, {
                    ...build,
                    downstream: gatherDownStream(root, path, iteration),
                }];
            });

        return {
            ...structuredClone(current),
            builds: Object.fromEntries(builds),
            children: current.children.map((x) => inner(root, x)),
        };
    }
    return ({ root: true, children: root.children.map((x) => inner(root, x)) });
}

function buildJobTree(jobs: ParsedJob[]): Root<UnresolvedJob> {
    function inner(jobs: ParsedJob[]): UnresolvedJob[] {
        const ret: UnresolvedJob[] = [];
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

export function buildTree(jobs: ParsedJob[]): Root<Job> {
    return reverseTestPathDirection(absoluteTestPaths(buildJobTree(jobs)));
}
