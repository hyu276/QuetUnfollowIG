const BRIDGE_SOURCE = "quet-unfollow-ig-web";
const port = chrome.runtime.connect({ name: "quet-unfollow-web-bridge" });
const pendingActions = new Map();

function postToPage(type, payload = {}) {
  window.postMessage({ source: BRIDGE_SOURCE, type, ...payload }, window.location.origin);
}

function sanitizeWebResult(message) {
  if (!message || message.type !== "WEB_RESPONSE" || !message.result) return message;
  const action = pendingActions.get(message.requestId);
  pendingActions.delete(message.requestId);

  if (action !== "GET_STATUS" && action !== "GET_CLOUD_CONFIG") return message;
  const result = structuredClone(message.result);
  if (result?.cloudConfig?.workspaceKey) delete result.cloudConfig.workspaceKey;
  if (result?.workspaceKey) delete result.workspaceKey;
  return { ...message, result };
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
  pendingActions.set(message.requestId, message.action);
  port.postMessage({
    type: "WEB_REQUEST",
    requestId: message.requestId,
    pairingKey: message.pairingKey,
    action: message.action,
    payload: message.payload || {}
  });
});

postToPage("BRIDGE_READY", {
  version: chrome.runtime.getManifest().version,
  extensionName: chrome.runtime.getManifest().name
});
