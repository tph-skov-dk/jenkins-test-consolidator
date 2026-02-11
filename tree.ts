import { Build, Job } from "./parsing.ts";

type RootLeaf = {
    root: true;
    children: JobLeaf[];
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

export function findElement(
    root: RootLeaf,
    components: string[],
): JobLeaf {
    function inner(
        root: RootLeaf,
        leaf: RootLeaf | JobLeaf,
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

export function buildTree(jobs: Job[]): RootLeaf {
    return resolveTestPaths(buildJobTree(jobs));
}
