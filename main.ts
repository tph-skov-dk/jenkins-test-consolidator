import { parseJobs } from "./parsing.ts";
import { render } from "./render2.ts";
import { buildTree, groupBuilds } from "./tree2.ts";
import * as fs from "@std/fs";
import * as path from "@std/path";

if (import.meta.main) {
    const target = Deno.args.at(0);
    const out = Deno.args.at(1) ?? "out";
    const skip: string[] = Deno.args.at(2)?.split(",") ?? ["Discontinued"];
    if (!target) {
        console.warn("no target specified");
        console.warn(
            `  hint: try <binary_path> <target> <output> <skip0,skip1,skip2>`,
        );
        Deno.exit(1);
    }
    if (!await fs.exists(path.join(target, "jobs"))) {
        console.warn(`expected '${target}' to have a jobs/ folder`);
        console.warn(
            `  hint: try specifying target as jenkins user working dir`,
        );
        Deno.exit(1);
    }
    const { builds, jobs } = buildTree(
        await parseJobs(target, skip),
    );

    await render(groupBuilds(builds), jobs, out);
    console.warn(`rendered to '${out}'`);
    Deno.exit(0);
}
