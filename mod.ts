import { parseJobs } from "./parsing.ts";
import { buildTree, Job } from "./tree.ts";

function debug(children: Job[]) {
    for (const item of children) {
        if (item.name.startsWith("Start")) {
            for (const iteration in item.builds) {
                const build = item.builds[iteration];
                if (build.downstream.length > 0) {
                    console.log(build.downstream);
                }
            }
        }
        debug(item.children);
    }
}

if (import.meta.main) {
    debug((buildTree(await parseJobs("test_input"))).children);
}
