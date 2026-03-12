import { Build, buildTree, JobInfo } from "./tree.ts";
import * as fs from "@std/fs";
import * as pathTools from "@std/path";
import { deduplicate } from "./deduplicate.ts";
type Export = Awaited<ReturnType<typeof buildTree>>;

export async function save(dir: string, data: Export) {
    await fs.ensureDir(dir);
    await Deno.writeTextFile(
        pathTools.join(dir, "jobs.json"),
        JSON.stringify(data.jobs),
    );
    await Deno.writeTextFile(
        pathTools.join(dir, ".gitignore"),
        "*",
    );

    for (const buildGroup of data.builds) {
        for (const build of buildGroup) {
            await Deno.writeTextFile(
                pathTools.join(
                    dir,
                    `build-${build.job}-${build.iteration}.json`,
                ),
                JSON.stringify(build),
            );
        }
    }
}

type OnDiskBuild = Omit<Build, "timestamp"> & { timestamp: string };
export async function load(dir: string): Promise<Export> {
    const jobs: JobInfo[] = [];
    const buildGroup = new Map<string, Build[]>();

    try {
        jobs.push(...JSON.parse(
            await Deno.readTextFile(
                pathTools.join(dir, "jobs.json"),
            ),
        ));
        for await (
            const entry of fs.walk(dir, {
                match: [/build-.+\.json/],
                skip: [/\.gitignore/],
                includeDirs: false,
                includeFiles: true,
            })
        ) {
            const onDiskBuild: OnDiskBuild = JSON.parse(
                await Deno.readTextFile(entry.path),
            );
            const build = {
                ...onDiskBuild,
                timestamp: new Date(onDiskBuild.timestamp),
            };
            if (!buildGroup.has(build.job)) {
                buildGroup.set(build.job, []);
            }
            buildGroup.get(build.job)?.push(build);
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
        }
    }
    return {
        jobs,
        builds: buildGroup.values().toArray(),
    };
}

export function merge(
    lhs: Export,
    rhs: Export,
): Export {
    const jobs = deduplicate(
        [...lhs.jobs, ...rhs.jobs],
        (lhs, rhs) => lhs.hash === rhs.hash,
    );
    const buildMap = new Map<string, Map<number, Build>>();
    for (const build of [...rhs.builds, ...lhs.builds].flat()) {
        if (!buildMap.has(build.job)) {
            buildMap.set(build.job, new Map());
        }
        buildMap.get(build.job)?.set(build.iteration, build);
    }
    const builds = buildMap.values().map((x) => x.values().toArray()).toArray();
    return { builds, jobs };
}
