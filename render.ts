import { escape } from "@std/html";
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

function renderProjectTree(root: Root, job: Job | Root): string {
    const header = job.root
        ? escape(job.name)
        : `<a href="/${absolutePath(root, job).join("/")}/index.html">${
            escape(job.name)
        }</a>`;
    const children = job.children.map((x) => renderProjectTree(root, x));
    return `
        <li>
            <p>${header}</p>
            ${children.length > 0 ? `<ul>${children.join("")}</ul>` : ""}
        </li>
`;
}

function renderViewPage(root: Root, job: Job) {
    const builds = Object
        .entries(job.builds)
        .sort(([lhs], [rhs]) => parseInt(lhs) - parseInt(rhs))
        .reverse()
        .map(([iteration, build]) => {
            return `<li><p><a href="build-${iteration}.html">Build ${
                escape(iteration)
            } - ${build.result}</a></p></li>`;
        })
        .join("");
    return `
        <h1>${escape(job.name)}</h1>
        <h2><a href="../index.html">Back</a></h2>
        <everything>
            <project-children>
                <h2>Children</h2>
                <hr>
                <ul>
                    ${renderProjectTree(root, job)}
                </ul>
            </project-children>
            <project-builds>
                <h2>Builds</h2>
                <hr>
                <ul>
                    ${builds}
                </ul>
            </project-builds>
        </everything>
`;
}

function renderRootPage(root: Root) {
    return `
        <h1>${root.name}</h1>
        <everything>
            <project-children>
                <h2>Children</h2>
                <ul>
                    ${renderProjectTree(root, root)}
                </ul>
            </project-children>
        </everything>
`;
}

function renderBuild(project: Job, iteration: number) {
    return `<build>
                <h2>${escape(project.name)} - Build ${
        escape(iteration.toString())
    } (${escape(project.builds[iteration].result)})</h2>
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
    iteration: number,
): { project: Job; iteration: number }[] {
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
    builds: { project: Job; iteration: number }[],
) {
    return `
        <h1>${project.name} - Build ${iteration}</h1>
        <h2><a href="index.html">Back</a></h2>
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
        padding: 0.5rem;
    }
    gap: 0.5rem;
    project-children > ul {
        border-left: none;
        padding-left: 0;
    }
}

ul {
    font-size: 1.5rem;
    border-left: 2px solid rgb(128, 128, 128);
    padding-left: 1ch;
    margin-left: 1ch;
    list-style:none;
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
    await fs.ensureDir(dest);
    await Deno.writeTextFile(pathTools.join(dest, ".gitignore"), "*");
    await Deno.writeTextFile(pathTools.join(dest, "style.css"), style());
    await Deno.writeTextFile(
        pathTools.join(dest, "index.html"),
        rootHtml(root.name, renderRootPage(root)),
    );
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
                    renderViewPage(root, job),
                ),
            );
            for (const iteration of Object.keys(job.builds)) {
                await Deno.writeTextFile(
                    pathTools.join(destDir, `build-${iteration}.html`),
                    rootHtml(
                        job.name,
                        renderBuildPage(
                            job,
                            iteration,
                            gatherBuilds(root, job, parseInt(iteration)),
                        ),
                    ),
                );
            }
        }
    }
    await inner(root, root.children, dest);
}
