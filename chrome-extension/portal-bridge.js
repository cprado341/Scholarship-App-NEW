const HANDOFF_MESSAGE = "SCHOLARSHIP_AGENT_EXTENSION_HANDOFF";
const ACK_MESSAGE = "SCHOLARSHIP_AGENT_EXTENSION_ACK";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== HANDOFF_MESSAGE) return;
  const requestId = String(event.data.requestId || "");
  chrome.runtime.sendMessage(
    {
      type: "SCHOLARSHIP_AGENT_HANDOFF",
      requestId,
      payload: event.data.payload || {}
    },
    (response) => {
      const error = chrome.runtime.lastError?.message;
      window.postMessage(
        {
          type: ACK_MESSAGE,
          requestId,
          ok: Boolean(response?.ok && !error),
          response: response || null,
          error: error || response?.error || ""
        },
        window.location.origin
      );
    }
  );
});
