import { Build, buildTree, groupBuilds, JobInfo } from "./tree2.ts";
import * as fs from "@std/fs";
import * as pathTools from "@std/path";
import { parseJobs, TestCase } from "./parsing.ts";

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

type ConsolidatedTestDims = TestCase & {
    job: string;
};

function gatherTests(build: Build): ConsolidatedTestDims[] {
    const mine = build.tests.map((x) => ({
        ...x,
        job: build.job,
    }));
    return [...mine, ...build.children.flatMap(gatherTests)];
}

type TestInfo = { job: string; testName: string };

function deduplicateTestInfo(
    tests: TestInfo[],
): TestInfo[] {
    return tests.reduce((acc: TestInfo[], v) => {
        if (acc.some((x) => x.job === v.job && x.testName === v.testName)) {
            return acc;
        }
        return [...acc, v];
    }, []);
}

function renderTests(
    tests: ConsolidatedTestDims[][],
    jobs: JobInfo[],
): string {
    const testInfo = deduplicateTestInfo(
        tests.flat().map((x) => ({
            testName: x.testName,
            job: x.job,
        })),
    );

    const ret = [];
    for (const info of testInfo) {
        let work = `<tr><td>${
            jobs.find((x) => x.uuid === info.job)?.relationship.join(".")
        } ${info.testName}</td>`;
        for (let i = 0; i < tests.length; ++i) {
            work += "<td>";
            const found = tests[i].find((x) => x.testName === info.testName);
            if (found) {
                work += `<test-result ${found.result}></test-result>`;
            }
            work += "</td>";
        }
        work += "</tr>";
        ret.push(work);
    }
    return ret.join("");
}

function renderBuild(builds: Build[], jobs: JobInfo[]): string {
    builds.sort((lhs, rhs) => lhs.iteration - rhs.iteration).reverse();
    const iterations = builds.map((x) => x.iteration);
    return `<table>
        <thead><tr>
            <th></th>
            ${iterations.map((x) => `<th scope="col">${x}</th>`).join("")}
        </tr></thead>
        <tbody>
            ${renderTests(builds.map(gatherTests), jobs)}
        </tbody>
    </table>`;
}

export async function render(
    buildGroups: Build[][],
    jobs: JobInfo[],
    dest: string,
) {
    console.log(buildGroups);
    await fs.ensureDir(dest);
    await Deno.writeTextFile(pathTools.join(dest, ".gitignore"), "*");
    await Deno.copyFile(
        "assets/style.css",
        pathTools.join(dest, "style.css"),
    );
    await Deno.writeTextFile(
        pathTools.join(dest, "index.html"),
        rootHtml(buildGroups.map((x) => renderBuild(x, jobs)).join("")),
    );
}

if (import.meta.main) {
    const { builds, jobs } = buildTree(
        await parseJobs("home/jenkins", ["Discontinued"]),
    );
    render(groupBuilds(builds), jobs, "out");
}
