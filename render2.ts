import { escape } from "@std/html";
import { Build, buildTree, JobInfo } from "./tree2.ts";
import * as fs from "@std/fs";
import * as pathTools from "@std/path";
import { parseJobs } from "./parsing.ts";


function rootHtml(body: string) {
    return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Test results</title>
                <link href="style.css" rel="stylesheet">
            </head>
            <body>
                ${body}
            </body>
        </html>
    `;
}

function renderBuild(build: Build, jobs: JobInfo[]): string {
    return `<table>${}</table>`
}

export async function render(builds: Build[], jobs: JobInfo[], dest: string) {
    await fs.ensureDir(dest);
    await Deno.writeTextFile(pathTools.join(dest, ".gitignore"), "*");
    await Deno.copyFile(
        "style.css",
        pathTools.join(dest, "style.css"),
    );

    await Deno.writeTextFile(
        rootHtml(renderBuild(builds[0], jobs)),
        pathTools.join(dest, "index.html"),
    );
}

if (import.meta.main) {
    const { builds, jobs } = buildTree(await parseJobs("home/jenkins"));
    render(builds, jobs, "out");
}
