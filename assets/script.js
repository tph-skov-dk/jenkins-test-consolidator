const expanded = new Set();

function collapse(job) {
    expanded.delete(job);
    for (const x of document.querySelectorAll(`tr[job="${job}"]`)) {
        x.style = "display: none;";
    }
}
function expand(job) {
    expanded.add(job);
    for (const x of document.querySelectorAll(`tr[job="${job}"]`)) {
        x.style = "";
    }
}

function main() {
    const toggle = document.querySelectorAll("[job-collapse-toggle]");
    for (const button of toggle) {
        const initialHtml = button.innerHTML;
        const job = button.getAttribute("job");
        button.innerHTML = `[+] ${initialHtml}`;
        collapse(job);

        button.addEventListener("click", () => {
            if (expanded.has(job)) {
                button.innerHTML = `[+] ${initialHtml}`;
                collapse(job);
            } else {
                button.innerHTML = `[-] ${initialHtml}`;
                expand(job);
            }
        });
    }
}

main();
