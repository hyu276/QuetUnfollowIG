const BRIDGE_SOURCE = "quet-unfollow-ig-web-v2";
const LEGACY_BRIDGE_SOURCE = "quet-unfollow-ig-web";
const PAIRING_KEY_STORAGE = "quetUnfollowIGPairingKey";
const BRIDGE_ID = chrome.runtime.id;
const ALLOWED_ACTIONS = new Set(["GET_STATUS", "CRAWL_NOW"]);
const pendingActions = new Map();

let port = null;
let reconnectTimer = null;
let keepAliveTimer = null;

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
  try {
    postToPage(source, "BRIDGE_READY", {
      version: chrome.runtime.getManifest().version,
      extensionName: chrome.runtime.getManifest().name,
      pairingFingerprint: await pairingFingerprint()
    });
  } catch (_) {}
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

function clearKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectPort();
  }, 750);
}

function handlePortMessage(message) {
  if (message?.type === "BRIDGE_ALIVE") return;

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
}

function connectPort() {
  if (port) return true;

  try {
    const nextPort = chrome.runtime.connect({ name: "quet-unfollow-web-bridge" });
    port = nextPort;

    nextPort.onMessage.addListener(handlePortMessage);
    nextPort.onDisconnect.addListener(() => {
      if (port !== nextPort) return;

      let reason = "Extension bridge disconnected. Đang tự kết nối lại…";
      try {
        if (chrome.runtime.lastError?.message) reason = chrome.runtime.lastError.message;
      } catch (_) {}

      port = null;
      clearKeepAlive();

      for (const [requestId, pending] of pendingActions.entries()) {
        rejectRequest(pending.source, requestId, "Extension bridge bị ngắt trong khi đang xử lý. Hãy thử lại sau khi bridge reconnect.");
      }
      pendingActions.clear();

      postToPage(BRIDGE_SOURCE, "BRIDGE_DISCONNECTED", { error: reason });
      postToPage(LEGACY_BRIDGE_SOURCE, "BRIDGE_DISCONNECTED", { error: reason });
      scheduleReconnect();
    });

    clearKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (!port) return;
      try {
        port.postMessage({ type: "BRIDGE_KEEPALIVE", at: Date.now() });
      } catch (_) {
        port = null;
        clearKeepAlive();
        scheduleReconnect();
      }
    }, 20000);

    announceBridge(BRIDGE_SOURCE);
    announceBridge(LEGACY_BRIDGE_SOURCE);
    return true;
  } catch (_) {
    port = null;
    clearKeepAlive();
    scheduleReconnect();
    return false;
  }
}

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.source !== BRIDGE_SOURCE && message?.source !== LEGACY_BRIDGE_SOURCE) return;

  if (message.type === "BRIDGE_PING") {
    connectPort();
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

  if (!port && !connectPort()) {
    rejectRequest(message.source, requestId, "Extension bridge đang reconnect. Hãy thử lại sau một giây.");
    return;
  }

  pendingActions.set(requestId, { action: message.action, source: message.source });
  try {
    port.postMessage({
      type: "WEB_REQUEST",
      requestId,
      pairingKey: message.pairingKey,
      action: message.action,
      payload: message.payload || {}
    });
  } catch (_) {
    pendingActions.delete(requestId);
    port = null;
    clearKeepAlive();
    scheduleReconnect();
    rejectRequest(message.source, requestId, "Extension bridge vừa bị ngắt. Đang tự kết nối lại.");
  }
});

connectPort();
announceBridge(BRIDGE_SOURCE);
announceBridge(LEGACY_BRIDGE_SOURCE);
