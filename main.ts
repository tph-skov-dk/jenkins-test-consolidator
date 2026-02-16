import { parseJobs } from "./parsing.ts";
import { render } from "./render.ts";
import { buildTree } from "./tree.ts";
import * as fs from "@std/fs";
import * as path from "@std/path";

if (import.meta.main) {
    const target = Deno.args[0];
    const out = Deno.args[1] ?? "out";
    const skip = Deno.args[2]?.split(",") ?? "out";
    if (!target) {
        console.warn("no target specified");
        console.warn(`  hint: try <binary_path> <target> <output> <skip0,skip1,skip2>`);
        Deno.exit(1);
    }
    if (!await fs.exists(path.join(target, "jobs"))) {
        console.warn(`expected '${target}' to have a jobs/ folder`);
        console.warn(
            `  hint: try specifying target as jenkins user working dir`,
        );
        Deno.exit(1);
    }
    await render(buildTree(await parseJobs(target, skip)), out);
    console.warn(`rendered to '${out}'`);
    Deno.exit(0);
}
