import { escape } from "node:querystring";
import { findElement, Job, Root } from "./tree.ts";
import * as fs from "@std/fs";
import * as pathTools from "@std/path";

function rootHtml(name: string, body: string) {
    return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${name}</title>
                <link href="style.css" rel="stylesheet">
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
            ${children.length > 0 && `<ul>${children.join("")}</ul>`}
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
    root: Root<Job>,
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

export async function render(root: Root<Job>, dest: string) {
    await fs.ensureDir(dest);
    await Deno.writeTextFile(pathTools.join(dest, ".gitignore"), "*");
    async function x(root: Root<Job>, children: Job[], dest: string) {
        for (const child of children) {
            await x(root, child.children, dest);
            const buildz = Object.keys(child.builds);
            if (buildz.length === 0) {
                continue;
            }

            const latest = buildz[buildz.length - 1];
            if (
                !(child.name === "Start-Tests" &&
                    child.configFile.includes("BD5XX"))
            ) {
                continue;
            }
            console.log(
                gatherBuilds(root, child, latest),
            );

            await Deno.writeTextFile(
                pathTools.join(dest, child.name + child.uuid + ".html"),
                rootHtml(
                    child.name,
                    renderBuildPage(
                        child,
                        latest,
                        gatherBuilds(root, child, latest),
                    ),
                ),
            );
        }
    }
    await x(root, root.children, dest);
}
