import { parseJobs } from "./parsing.ts";
import { buildTree, JobLeaf } from "./tree.ts";

function debug(children: JobLeaf[]) {
    for (const item of children) {
        if (item.name.startsWith("Labgrid")) {
            for (const iteration in item.builds) {
                const build = item.builds[iteration];
                console.log(build.upstream);
            }
        }
        debug(item.children);
    }
}

if (import.meta.main) {
    debug((buildTree(await parseJobs("test_input"))).children);
}
