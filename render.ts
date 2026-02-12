import { escape } from "node:querystring";
import {
    absolutePath,
    DownstreamBuild,
    findElement,
    Job as GenericJob,
    Root as GenericRoot,
} from "./tree.ts";
import * as fs from "@std/fs";
import * as pathTools from "@std/path";

type Job = GenericJob<DownstreamBuild>;
type Root = GenericRoot<DownstreamBuild>;

function rootHtml(name: string, body: string) {
    return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${name}</title>
                <link href="/style.css" rel="stylesheet">
            </head>
            <body>
                ${body}
            </body>
        </html>
    `;
}

function renderProjectTree(root: Job): string {
    const children = root.children.map(renderProjectTree);
    return `
            <li><p><a href="#">${escape(root.name)}</a></p>
            ${children.length > 0 ? `<ul>${children.join("")}</ul>` : ""}
                </li>
`;
}

function renderIndexPage(root: Job) {
    return `
            <h1>Pims 9.1.x</h1>
        <everything>
            <project-children>
                <h2>Children</h2>
                <ul>
                    ${renderProjectTree(root)}
                </ul>
            </project-children>
            <project-builds>
                <h2>Builds</h2>
                <ul>
                    ${
        Object.entries(root.builds).map(([iteration, build]) => {
            return `<li><p><a href="#">Build ${
                escape(iteration)
            } - ${build.result}</a></p></li>`;
        })
    }
                </ul>
            </project-builds>
        </everything>
`;
}
function renderBuild(project: Job, iteration: string) {
    return `<build>
                <h2>${escape(project.name)} - Build ${escape(iteration)} (${
        escape(project.builds[iteration].result)
    })</h2>
    ${
        project.builds[iteration].tests.map((test) => {
            const type: "success" | "skipped" | "failed" = test.result;

            return `<case ${type}><case-name>${
                escape(test.testName)
            }</case-name> ${test.duration}s | ${
                type.padStart("skipped".length)
            }</case>`;
        }).join("")
    }
            </build>
`;
}

function gatherBuilds(
    root: Root,
    project: Job,
    iteration: string,
): { project: Job; iteration: string }[] {
    const ret = [];
    ret.push({ project, iteration });
    const build = project.builds[iteration];
    for (const downstream of build.downstream) {
        const project = findElement(root, downstream.project);
        ret.push(...gatherBuilds(root, project, downstream.iteration));
    }
    return ret;
}

function renderBuildPage(
    project: Job,
    iteration: string,
    builds: { project: Job; iteration: string }[],
) {
    return `
        <h1>${project.name} - Build ${iteration}</h1>
        <project-test-grid>
            ${builds.map((x) => renderBuild(x.project, x.iteration)).join("")}
        </project-test-grid>
`;
}

function style() {
    return `
:root {
    color-scheme: dark;
    font-family:
        system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
}

everything {
    display: flex;
    > * {
        > h2 {
            margin-top: 0;
        }
        > :last-child {
            margin-bottom: 0;
        }
        flex: 1;
        border: 1px solid;
        padding: 0.5rem;
    }
    gap: 0.5rem;
}

ul {
    font-size: 1.5rem;
    padding-left: 2ch;
    p {
        margin-block: 0.25rem;
        font-weight: bold;
    }
}

project-test-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 0.5rem;

    build {
        padding: 1rem;
        h2 {
            margin-top: 0;
        }
        border: 1px solid;
    }

    case {
        &[passed] {
            background-color: #589b31;
        }
        &[skipped] {
            background-color: #ffe74c;
            color: black;
        }
        &[failed] {
            background-color: #d6371f;
        }
        padding: 0.25rem;
        display: flex;
        font-family: monospace;

        case-name {
            flex: 1;
        }
    }
}

body {
    max-width: 1000px;
    margin: 0 auto;
    padding: 1rem;
}`;
}

export async function render(root: Root, dest: string) {
    await fs.emptyDir(dest);
    await Deno.writeTextFile(pathTools.join(dest, ".gitignore"), "*");
    await Deno.writeTextFile(pathTools.join(dest, "style.css"), style());
    async function inner(
        root: Root,
        jobs: Job[],
        dest: string,
    ) {
        for (const job of jobs) {
            await inner(root, job.children, dest);
            const destDir = pathTools.join(dest, ...absolutePath(root, job));
            await fs.ensureDir(
                destDir,
            );

            await Deno.writeTextFile(
                pathTools.join(destDir, "index.html"),
                rootHtml(
                    job.name,
                    renderIndexPage(job),
                ),
            );
            for (const iteration of Object.keys(job.builds)) {
                await Deno.writeTextFile(
                    pathTools.join(destDir, "builds.html"),
                    rootHtml(
                        job.name,
                        renderBuildPage(
                            job,
                            iteration,
                            gatherBuilds(root, job, iteration),
                        ),
                    ),
                );
            }
        }
    }
    await inner(root, root.children, dest);
}
