import { parseJobs } from "./parsing.ts";
import { render } from "./render.ts";
import { buildTree } from "./tree.ts";

if (import.meta.main) {
    await render(buildTree(await parseJobs("test_input")), "out");
}
