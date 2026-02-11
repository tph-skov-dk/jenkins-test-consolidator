import { escape } from "node:querystring";
import { Build } from "./parsing.ts";
import { JobLeaf, RootLeaf } from "./tree.ts";

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

function renderProjectTree(root: JobLeaf): string {
    const children = root.children.map(renderProjectTree);
    return `
            <li><p><a href="#">${escape(root.name)}</a></p>
            ${children.length > 0 && `<ul>${children.join("")}</ul>`}
                </li>
`;
}

function renderIndexPage(root: JobLeaf) {
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
function renderBuild(project: JobLeaf, iteration: string) {
    return `<build>
                <h2>${escape(project.name)} - Build ${escape(iteration)} (${
        escape(project.builds[iteration].result)
    })</h2>
    ${
        project.builds[iteration].tests.map((test) => {
            const type: "success" | "skipped" | "failed" = test.result;

            return `<case ${type}><case-name>${
                escape(test.testName)
            }</case-name> 0.52s | ${type.padStart("skipped".length)}</case>`;
        }).join("")
    }
            </build>
`;
}

function renderBuildPage(
    project: JobLeaf,
    iteration: string,
    builds: { project: JobLeaf; iteration: string }[],
) {
    `
        <h1>${project.name} - Build ${iteration}</h1>
        <project-test-grid>
            ${builds.map((x) => renderBuild(x.project, x.iteration))}
        </project-test-grid>
`;
}

export function render(root: RootLeaf, dest: string) {}
