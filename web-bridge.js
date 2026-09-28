const BRIDGE_SOURCE = "quet-unfollow-ig-web-v2";
const LEGACY_BRIDGE_SOURCE = "quet-unfollow-ig-web";
const PAIRING_KEY_STORAGE = "quetUnfollowIGPairingKey";
const BRIDGE_ID = chrome.runtime.id;
const ALLOWED_ACTIONS = new Set(["GET_STATUS", "CRAWL_NOW"]);
const port = chrome.runtime.connect({ name: "quet-unfollow-web-bridge" });
const pendingActions = new Map();

function postToPage(source, type, payload = {}) {
  window.postMessage({ source, bridgeId: BRIDGE_ID, type, ...payload }, window.location.origin);
}

async function storedPairingKey() {
  const stored = await chrome.storage.local.get(PAIRING_KEY_STORAGE);
  return String(stored[PAIRING_KEY_STORAGE] || "").trim();
}

async function pairingFingerprint() {
  const key = await storedPairingKey();
  if (!/^[a-f0-9]{36}$/i.test(key)) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function announceBridge(source) {
  postToPage(source, "BRIDGE_READY", {
    version: chrome.runtime.getManifest().version,
    extensionName: chrome.runtime.getManifest().name,
    pairingFingerprint: await pairingFingerprint()
  });
}

function sanitizeWebResult(message) {
  if (!message || message.type !== "WEB_RESPONSE" || !message.result) return message;
  pendingActions.delete(message.requestId);
  const result = structuredClone(message.result);
  if (result?.cloudConfig?.workspaceKey) delete result.cloudConfig.workspaceKey;
  if (result?.workspaceKey) delete result.workspaceKey;
  return { ...message, result };
}

function rejectRequest(source, requestId, error) {
  postToPage(source, "WEB_RESPONSE", {
    requestId,
    ok: false,
    error
  });
}

port.onMessage.addListener((message) => {
  if (message?.type === "CRAWL_PROGRESS") {
    postToPage(BRIDGE_SOURCE, "CRAWL_PROGRESS", { payload: message.payload });
    postToPage(LEGACY_BRIDGE_SOURCE, "CRAWL_PROGRESS", { payload: message.payload });
    return;
  }
  if (message?.type === "WEB_RESPONSE") {
    const pending = pendingActions.get(message.requestId);
    if (!pending) return;
    postToPage(pending.source, "WEB_RESPONSE", sanitizeWebResult(message));
  }
});

port.onDisconnect.addListener(() => {
  pendingActions.clear();
  const payload = {
    error: chrome.runtime.lastError?.message || "Extension bridge disconnected."
  };
  postToPage(BRIDGE_SOURCE, "BRIDGE_DISCONNECTED", payload);
  postToPage(LEGACY_BRIDGE_SOURCE, "BRIDGE_DISCONNECTED", payload);
});

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.source !== BRIDGE_SOURCE && message?.source !== LEGACY_BRIDGE_SOURCE) return;

  if (message.type === "BRIDGE_PING") {
    announceBridge(message.source);
    return;
  }

  if (message.type !== "WEB_REQUEST") return;
  if (message.source === BRIDGE_SOURCE && message.bridgeId !== BRIDGE_ID) return;
  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  if (!requestId) {
    rejectRequest(message.source, "", "Bridge requestId không hợp lệ.");
    return;
  }
  if (!ALLOWED_ACTIONS.has(message.action)) {
    rejectRequest(message.source, requestId, "Web action không được phép qua bridge.");
    return;
  }
  if (!/^[a-f0-9]{36}$/i.test(String(message.pairingKey || ""))) {
    rejectRequest(message.source, requestId, "Pairing key không đúng định dạng.");
    return;
  }
  if (message.source === LEGACY_BRIDGE_SOURCE && message.pairingKey !== await storedPairingKey()) return;

  pendingActions.set(requestId, { action: message.action, source: message.source });
  port.postMessage({
    type: "WEB_REQUEST",
    requestId,
    pairingKey: message.pairingKey,
    action: message.action,
    payload: message.payload || {}
  });
});

announceBridge(BRIDGE_SOURCE);
announceBridge(LEGACY_BRIDGE_SOURCE);
