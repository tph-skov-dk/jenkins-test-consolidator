function collapseJob(job, expandedJobs) {
    expandedJobs.delete(job);
    for (const x of document.querySelectorAll(`tr[job="${job}"]`)) {
        x.style = "display: none;";
    }
}
function expandJob(job, expandedJobs) {
    expandedJobs.add(job);
    for (const x of document.querySelectorAll(`tr[job="${job}"]`)) {
        x.style = "";
    }
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function initializeTestResultDetailDialog() {
    const dialog = document.querySelector("#case-details-dialog");
    const dialogClose = document.querySelector(
        "#case-details-dialog-close",
    );
    const dialogContent = document.querySelector(
        "#case-details-dialog-content",
    );

    dialogClose.addEventListener("click", () => {
        dialog.close();
    });
    for (const item of document.querySelectorAll("test-result[info][failed]")) {
        item.addEventListener("click", () => {
            const data = JSON.parse(item.getAttribute("info"));
            dialogContent.innerHTML = `<p>Details: ${
                data.error?.details
                    ? `'${escapeHtml(data.error.details)}'`
                    : "None"
            }</p><hr><p>Trace: ${
                data.error?.stackTrace
                    ? `<pre trace>${escapeHtml(data.error.stackTrace)}</pre>`
                    : "None"
            }</p>`;
            dialog.showModal();
        });
    }
}

function initializeJobExpansion() {
    const expandedJobs = new Set();

    const toggle = document.querySelectorAll("[job-collapse-toggle]");
    for (const button of toggle) {
        const initialHtml = button.innerHTML;
        const job = button.getAttribute("job");
        button.innerHTML = `[+] ${initialHtml}`;
        collapseJob(job, expandedJobs);

        button.addEventListener("click", () => {
            if (expandedJobs.has(job)) {
                button.innerHTML = `[+] ${initialHtml}`;
                collapseJob(job, expandedJobs);
            } else {
                button.innerHTML = `[-] ${initialHtml}`;
                expandJob(job, expandedJobs);
            }
        });
    }
}

function main() {
    initializeJobExpansion();
    initializeTestResultDetailDialog();
}

main();
