import { parseJobs } from "./parsing.ts";
import { render } from "./render.ts";
import { buildTree } from "./tree.ts";
import * as path from "@std/path";
import * as cache from "./cache.ts";

function withSlashes(input: string): string {
    if (!input.startsWith("/")) {
        input = "/" + input;
    }
    if (!input.endsWith("/")) {
        input = input + "/";
    }
    return input;
}

if (import.meta.main) {
    const target = Deno.args.at(0);
    const cacheDir = Deno.args.at(1);
    const out = Deno.args.at(2) ?? "out";
    const rootPathPrefix = withSlashes(Deno.args.at(3) ?? "/");
    const skip = Deno.args.at(4)?.split(",") ?? ["Discontinued"];
    if (!target || !cacheDir) {
        console.warn("no target or cache dir specified");
        console.warn(
            `  hint: try <binary_path> <target> <cache dir> <output> <root path> <skip0,skip1,skip2>`,
        );
        Deno.exit(1);
    }
    if (path.basename(target) !== "jobs") {
        console.warn(`expected '${target}' to be a jobs/ folder`);
        console.warn(
            `  hint: try specifying target as <jenkins user working dir>/jobs`,
        );
        Deno.exit(1);
    }

    const builtTree = await buildTree(
        await parseJobs(target, skip),
    );
    const existing = await cache.load(cacheDir);
    const merged = cache.merge(existing, builtTree);
    await cache.save(cacheDir, merged);
    console.warn(`cached at '${cacheDir}'`);

    await render(merged.builds, merged.jobs, out, rootPathPrefix);
    console.warn(`rendered to '${out}'`);
    Deno.exit(0);
}
