const STORAGE_KEY = "scholarshipAgentHandoff";
const STATUS_KEY = "scholarshipAgentStatus";
const LOCAL_ORIGINS = new Set(["http://localhost:4317", "http://127.0.0.1:4317"]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCHOLARSHIP_AGENT_HANDOFF") {
    handleHandoff(message.payload || {})
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Extension handoff failed." }));
    return true;
  }

  if (message?.type === "SCHOLARSHIP_AGENT_FILL_ACTIVE") {
    fillActiveTab()
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not fill the active tab." }));
    return true;
  }

  if (message?.type === "SCHOLARSHIP_AGENT_GET_STATUS") {
    getStatus().then((status) => sendResponse({ ok: true, status }));
    return true;
  }

  if (message?.type === "SCHOLARSHIP_AGENT_CLEAR") {
    clearState().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

async function handleHandoff(payload) {
  const apiBaseUrl = validApiBaseUrl(payload.apiBaseUrl);
  const launchUrl = validHttpUrl(payload.launchUrl);
  const token = String(payload.token || "").trim();
  if (!apiBaseUrl) throw new Error("The portal URL is not trusted by this local extension.");
  if (!launchUrl) throw new Error("This scholarship does not have a valid application URL.");
  if (!token) throw new Error("The portal did not provide a companion token.");

  await setStatus({ state: "loading", message: "Loading approved fill plan from Scholarship Agent." });
  const fillPlan = await fetchFillPlan(apiBaseUrl, token);
  const handoff = {
    apiBaseUrl,
    launchUrl,
    fillPlan,
    receivedAt: new Date().toISOString()
  };
  await chrome.storage.session.set({ [STORAGE_KEY]: handoff });
  const tab = (await findExistingApplicationTab(launchUrl)) || (await chromeTabsCreate({ url: launchUrl, active: true }));
  await waitForTabComplete(tab.id);
  const result = await injectAndFill(tab.id, handoff);
  await setStatus({
    state: result.status || "ready",
    message: result.message || "Fill attempt finished.",
    scholarshipTitle: fillPlan.scholarship?.title || payload.scholarshipTitle || "",
    studentName: fillPlan.student?.preferredName || payload.studentName || "",
    filledFields: result.filledFields || [],
    skippedFields: result.skippedFields || [],
    blockers: result.blockers || []
  });
  return { result };
}

async function fillActiveTab() {
  const handoff = await getStoredHandoff();
  if (!handoff) throw new Error("No approved fill plan is loaded yet.");
  const [tab] = await chromeTabsQuery({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Open the scholarship application tab before filling.");
  const result = await injectAndFill(tab.id, handoff);
  await setStatus({
    state: result.status || "ready",
    message: result.message || "Fill attempt finished.",
    scholarshipTitle: handoff.fillPlan?.scholarship?.title || "",
    studentName: handoff.fillPlan?.student?.preferredName || "",
    filledFields: result.filledFields || [],
    skippedFields: result.skippedFields || [],
    blockers: result.blockers || []
  });
  return { result };
}

async function fetchFillPlan(apiBaseUrl, token) {
  const response = await fetch(`${apiBaseUrl}/api/companion/submission-session`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "The approved fill plan could not be loaded.");
  }
  return payload;
}

async function injectAndFill(tabId, handoff) {
  await chromeScriptingExecuteScript({ target: { tabId }, files: ["autofill-content.js"] });
  return chromeTabsSendMessage(tabId, {
    type: "SCHOLARSHIP_AGENT_FILL",
    payload: handoff
  });
}

function validApiBaseUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    const origin = url.origin;
    return LOCAL_ORIGINS.has(origin) ? origin : "";
  } catch {
    return "";
  }
}

function validHttpUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

async function findExistingApplicationTab(launchUrl) {
  const tabs = await chromeTabsQuery({});
  const target = normalizeUrlForMatch(launchUrl);
  return tabs.find((tab) => normalizeUrlForMatch(tab.url) === target) || null;
}

function normalizeUrlForMatch(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

async function getStoredHandoff() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

async function getStatus() {
  const stored = await chrome.storage.session.get([STATUS_KEY, STORAGE_KEY]);
  return (
    stored[STATUS_KEY] || {
      state: stored[STORAGE_KEY] ? "ready" : "empty",
      message: stored[STORAGE_KEY] ? "Approved fill plan loaded." : "No approved fill plan loaded yet."
    }
  );
}

async function setStatus(status) {
  await chrome.storage.session.set({ [STATUS_KEY]: { ...status, updatedAt: new Date().toISOString() } });
}

async function clearState() {
  await chrome.storage.session.remove([STORAGE_KEY, STATUS_KEY]);
}

function chromeTabsCreate(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function chromeTabsQuery(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(options, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tabs);
    });
  });
}

function chromeTabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response || {});
    });
  });
}

function chromeScriptingExecuteScript(options) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(options, (results) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(results);
    });
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab?.status === "complete") {
        resolve();
        return;
      }
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 12000);
    });
  });
}
