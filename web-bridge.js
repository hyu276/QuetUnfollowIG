const BRIDGE_SOURCE = "quet-unfollow-ig-web";
const ALLOWED_ACTIONS = new Set(["GET_STATUS", "CRAWL_NOW"]);
const port = chrome.runtime.connect({ name: "quet-unfollow-web-bridge" });
const pendingActions = new Map();

function postToPage(type, payload = {}) {
  window.postMessage({ source: BRIDGE_SOURCE, type, ...payload }, window.location.origin);
}

function sanitizeWebResult(message) {
  if (!message || message.type !== "WEB_RESPONSE" || !message.result) return message;
  pendingActions.delete(message.requestId);
  const result = structuredClone(message.result);
  if (result?.cloudConfig?.workspaceKey) delete result.cloudConfig.workspaceKey;
  if (result?.workspaceKey) delete result.workspaceKey;
  return { ...message, result };
}

function rejectRequest(requestId, error) {
  postToPage("WEB_RESPONSE", {
    requestId,
    ok: false,
    error
  });
}

port.onMessage.addListener((message) => {
  if (message?.type === "CRAWL_PROGRESS") {
    postToPage("CRAWL_PROGRESS", { payload: message.payload });
    return;
  }
  if (message?.type === "WEB_RESPONSE") {
    postToPage("WEB_RESPONSE", sanitizeWebResult(message));
  }
});

port.onDisconnect.addListener(() => {
  pendingActions.clear();
  postToPage("BRIDGE_DISCONNECTED", {
    error: chrome.runtime.lastError?.message || "Extension bridge disconnected."
  });
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.source !== BRIDGE_SOURCE) return;

  if (message.type === "BRIDGE_PING") {
    postToPage("BRIDGE_READY", {
      version: chrome.runtime.getManifest().version,
      extensionName: chrome.runtime.getManifest().name
    });
    return;
  }

  if (message.type !== "WEB_REQUEST") return;
  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  if (!requestId) {
    rejectRequest("", "Bridge requestId không hợp lệ.");
    return;
  }
  if (!ALLOWED_ACTIONS.has(message.action)) {
    rejectRequest(requestId, "Web action không được phép qua bridge.");
    return;
  }
  if (!/^[a-f0-9]{36}$/i.test(String(message.pairingKey || ""))) {
    rejectRequest(requestId, "Pairing key không đúng định dạng.");
    return;
  }

  pendingActions.set(requestId, message.action);
  port.postMessage({
    type: "WEB_REQUEST",
    requestId,
    pairingKey: message.pairingKey,
    action: message.action,
    payload: message.payload || {}
  });
});

postToPage("BRIDGE_READY", {
  version: chrome.runtime.getManifest().version,
  extensionName: chrome.runtime.getManifest().name
});
