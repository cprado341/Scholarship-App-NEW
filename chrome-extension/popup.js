const stateEl = document.querySelector("#state");
const detailsEl = document.querySelector("#details");
const fillActiveButton = document.querySelector("#fillActive");
const clearButton = document.querySelector("#clear");

document.addEventListener("DOMContentLoaded", refreshStatus);
fillActiveButton.addEventListener("click", async () => {
  setBusy("Filling...");
  const response = await sendMessage({ type: "SCHOLARSHIP_AGENT_FILL_ACTIVE" });
  renderResponse(response);
});
clearButton.addEventListener("click", async () => {
  await sendMessage({ type: "SCHOLARSHIP_AGENT_CLEAR" });
  refreshStatus();
});

async function refreshStatus() {
  const response = await sendMessage({ type: "SCHOLARSHIP_AGENT_GET_STATUS" });
  renderStatus(response.status || { state: "empty", message: "No approved fill plan loaded yet." });
}

function renderResponse(response) {
  if (!response?.ok) {
    renderStatus({ state: "error", message: response?.error || "Could not complete the action." });
    return;
  }
  renderStatus(response.result || response.status || { state: "ready", message: "Done." });
}

function renderStatus(status) {
  stateEl.textContent = status.state || status.status || "ready";
  const filled = status.filledFields || [];
  const skipped = status.skippedFields || [];
  const blockers = status.blockers || [];
  detailsEl.innerHTML = `
    <p>${escapeHtml(status.message || "Ready.")}</p>
    ${status.scholarshipTitle ? `<p><strong>${escapeHtml(status.scholarshipTitle)}</strong></p>` : ""}
    ${status.studentName ? `<p>Student: ${escapeHtml(status.studentName)}</p>` : ""}
    ${filled.length ? list("Filled", filled) : ""}
    ${skipped.length ? list("Not filled yet", skipped) : ""}
    ${blockers.length ? list("Needs review", blockers) : ""}
  `;
}

function list(label, values) {
  return `<div><strong>${escapeHtml(label)}</strong><ul>${values.slice(0, 6).map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></div>`;
}

function setBusy(message) {
  stateEl.textContent = "working";
  detailsEl.innerHTML = `<p>${escapeHtml(message)}</p>`;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError?.message;
      resolve(error ? { ok: false, error } : response || { ok: false, error: "No extension response." });
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
