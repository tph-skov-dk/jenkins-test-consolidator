import { Build as UnresolvedBuild, Job } from "./parsing.ts";

type Replace<T, K extends keyof T, S> = Omit<T, K> & S;

export type Build = Replace<UnresolvedBuild, "upstream", {
    downstream: {
        project: string[];
        iteration: string;
    }[];
}>;

type UnresolvedJobLeaf = {
    root: false;
    uuid: string;
    name: string;
    configFile: string;
    builds: { [key: string]: UnresolvedBuild };
    triggers: string[][];
    children: UnresolvedJobLeaf[];
};

export type Root<T> = {
    root: true;
    children: T[];
};

export type JobLeaf = {
    root: false;
    uuid: string;
    name: string;
    configFile: string;
    builds: { [key: string]: Build };
    triggers: string[][];
    children: JobLeaf[];
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
    root: Root<UnresolvedJobLeaf>,
    target: UnresolvedJobLeaf,
): UnresolvedJobLeaf | Root<UnresolvedJobLeaf> {
    function inner(
        root: Root<UnresolvedJobLeaf> | UnresolvedJobLeaf,
        src: UnresolvedJobLeaf,
    ): UnresolvedJobLeaf | Root<UnresolvedJobLeaf> | undefined {
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
    root: Root<UnresolvedJobLeaf>,
    initial: UnresolvedJobLeaf,
    components: string[],
): UnresolvedJobLeaf {
    function inner(
        root: Root<UnresolvedJobLeaf>,
        leaf: Root<UnresolvedJobLeaf> | UnresolvedJobLeaf,
        components: string[],
    ): UnresolvedJobLeaf | undefined {
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
    root: Root<JobLeaf>,
    components: string[],
): JobLeaf {
    function inner(
        root: Root<JobLeaf>,
        leaf: Root<JobLeaf> | JobLeaf,
        components: string[],
    ): JobLeaf | undefined {
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
    root: Root<UnresolvedJobLeaf>,
    leaf: UnresolvedJobLeaf,
): string[] {
    function inner(
        jobs: UnresolvedJobLeaf[],
        leaf: UnresolvedJobLeaf,
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
    root: Root<UnresolvedJobLeaf>,
): Root<UnresolvedJobLeaf> {
    function inner(
        root: Root<UnresolvedJobLeaf>,
        current: UnresolvedJobLeaf,
    ): UnresolvedJobLeaf {
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

function reverseTestPathDirection(
    root: Root<UnresolvedJobLeaf>,
): Root<JobLeaf> {
    function inner(
        root: Root<UnresolvedJobLeaf>,
        current: UnresolvedJobLeaf,
    ): UnresolvedJobLeaf {
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
    const _x = { ...root, children: root.children.map((x) => inner(root, x)) };
    throw new Error("unimpl");
}

function buildJobTree(jobs: Job[]): Root<UnresolvedJobLeaf> {
    function inner(jobs: Job[]): UnresolvedJobLeaf[] {
        const ret: UnresolvedJobLeaf[] = [];
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

export function buildTree(jobs: Job[]): Root<JobLeaf> {
    return reverseTestPathDirection(absoluteTestPaths(buildJobTree(jobs)));
}
