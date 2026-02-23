import { Build, buildTree, groupBuilds, JobInfo } from "./tree.ts";
import * as fs from "@std/fs";
import * as pathTools from "@std/path";
import { parseJobs, TestCase } from "./parsing.ts";
import { escape } from "@std/html";

function rootHtml(body: string, rootPathPrefix: string) {
    return `
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Test results</title>
                <link href="${rootPathPrefix}style.css" rel="stylesheet">
                <script defer src="${rootPathPrefix}script.js"></script>
            </head>
            <body>
                ${body}
            </body>
        </html>
    `;
}

type TestCaseWithJob = TestCase & {
    job: string;
};

function gatherTests(build: Build): TestCaseWithJob[] {
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

function renderJobTestGroup(
    job: string,
    tests: TestCaseWithJob[][],
    jobs: JobInfo[],
): string {
    let work = `<tr scope="row"><td><job-collapse-toggle job="${job}">${
        jobs.find((x) => x.uuid === job)!.relationship.join(".")
    }</job-collapse-toggle></td>`;
    for (let i = 0; i < tests.length; ++i) {
        work += "<td>";
        const relatedTests = tests[i].filter((x) => x.job === job);
        if (relatedTests.length === 0) {
            work += "</td>";
            continue;
        }
        let result: TestCase["result"];
        if (relatedTests.every((x) => x.result === "skipped")) {
            result = "skipped";
        } else if (relatedTests.some((x) => x.result === "failed")) {
            result = "failed";
        } else {
            result = "success";
        }
        work += `<test-result ${result}></test-result>`;
        work += "</td>";
    }
    work += "</tr>";

    return work;
}

function sortRelationship(lhs: string[], rhs: string[]): number {
    for (let i = 0; i < Math.min(lhs.length, rhs.length); ++i) {
        const cmp = lhs[i].localeCompare(rhs[i]);
        if (cmp !== 0) {
            return cmp;
        }
    }
    return lhs.length - rhs.length;
}

function renderTests(
    tests: TestCaseWithJob[][],
    jobs: JobInfo[],
): string {
    const testInfo = deduplicateTestInfo(
        tests.flat().map((x) => ({
            testName: x.testName,
            job: x.job,
        })),
    ).toSorted((lhs, rhs) => lhs.job.localeCompare(rhs.job));

    const ret = [];
    let mostRecentJob = "";
    for (const info of testInfo) {
        if (info.job !== mostRecentJob) {
            mostRecentJob = info.job;
            ret.push(renderJobTestGroup(info.job, tests, jobs));
        }
        let work = `<tr job="${info.job}"><td>.... ${info.testName}</td>`;
        for (let i = 0; i < tests.length; ++i) {
            work += "<td>";
            const found = tests[i].find((x) =>
                x.testName === info.testName && x.job === info.job
            );
            if (found) {
                work += `<test-result ${found.result} info="${
                    escape(JSON.stringify(found.job))
                }"></test-result>`;
            }
            work += "</td>";
        }
        work += "</tr>";
        ret.push(work);
    }
    return ret.join("");
}

function formatDate(date: Date): string {
    return `${date.getDate()}/${date.getMonth() + 1}-${date.getFullYear()}`;
}

function renderBuild(builds: Build[], jobs: JobInfo[]): string {
    builds = builds
        .toSorted((lhs, rhs) => lhs.iteration - rhs.iteration)
        .toReversed()
        .filter((_, i) => i < 10);
    return `<table>
        <thead><tr>
            <th>${
        jobs.find((x) => x.uuid === builds[0].job)?.relationship.join(".")
    }</th>
            ${
        builds.map(({ timestamp, iteration }) =>
            `<th scope="col"><build-name>Build ${iteration}, ${
                formatDate(timestamp)
            }</build-name></th>`
        ).join("")
    }
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
    rootPathPrefix: string,
) {
    await fs.ensureDir(dest);
    await Deno.writeTextFile(pathTools.join(dest, ".gitignore"), "*");
    await Deno.copyFile(
        pathTools.join(import.meta.dirname!, "assets/style.css"),
        pathTools.join(dest, "style.css"),
    );
    await Deno.copyFile(
        pathTools.join(import.meta.dirname!, "assets/script.js"),
        pathTools.join(dest, "script.js"),
    );
    for (const group of buildGroups) {
        const rootJob = jobs.find((x) => x.uuid === group[0].job);
        if (!rootJob) {
            throw new Error("unreachable");
        }
        const isSameJob = group.every((x) => x.job === rootJob.uuid);
        if (!isSameJob) {
            throw new Error("expected builds to have same root job");
        }
        const path = pathTools.join(
            dest,
            rootJob.relationship.join("."),
            "index.html",
        );
        await fs.ensureFile(path);
        await Deno.writeTextFile(
            path,
            rootHtml(renderBuild(group, jobs), rootPathPrefix),
        );
    }
    const links = buildGroups.map(([group]) => {
        const rootJob = jobs.find((job) => job.uuid === group.job);
        if (!rootJob) {
            throw new Error("unreachable");
        }
        return `<li><a href="${rootPathPrefix}${
            rootJob.relationship.join(".")
        }">${rootJob.relationship.join(".")}</a></li>`;
    });
    await Deno.writeTextFile(
        pathTools.join(dest, "index.html"),
        rootHtml(`<ul>${links.join("")}</ul>`, rootPathPrefix),
    );
}

if (import.meta.main) {
    const { builds, jobs } = buildTree(
        await parseJobs("home/jenkins", ["Discontinued"]),
    );
    const grouped = groupBuilds(builds);
    grouped.sort((lhs, rhs) => {
        const lhs2 = jobs.find((x) => x.uuid === lhs[0].job)!;
        const rhs2 = jobs.find((x) => x.uuid === rhs[0].job)!;
        return sortRelationship(lhs2.relationship, rhs2.relationship);
    });
    render(groupBuilds(builds), jobs, "out", "/");
}
