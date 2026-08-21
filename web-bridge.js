const BRIDGE_SOURCE = "quet-unfollow-ig-web";
const port = chrome.runtime.connect({ name: "quet-unfollow-web-bridge" });

function bridgeInfo() {
  const manifest = chrome.runtime.getManifest();
  return { version: manifest.version, extensionName: manifest.name };
}

function postToPage(type, payload = {}) {
  window.postMessage({ source: BRIDGE_SOURCE, type, ...payload }, window.location.origin);
}

port.onMessage.addListener((message) => {
  if (message?.type === "CRAWL_PROGRESS") {
    postToPage("CRAWL_PROGRESS", { payload: message.payload });
    return;
  }
  if (message?.type === "WEB_RESPONSE") {
    postToPage("WEB_RESPONSE", message);
  }
});

port.onDisconnect.addListener(() => {
  postToPage("BRIDGE_DISCONNECTED", {
    error: chrome.runtime.lastError?.message || "Extension bridge disconnected."
  });
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.source !== BRIDGE_SOURCE) return;

  if (message.type === "BRIDGE_PING") {
    postToPage("BRIDGE_READY", bridgeInfo());
    return;
  }

  if (message.type !== "WEB_REQUEST") return;
  port.postMessage({
    type: "WEB_REQUEST",
    requestId: message.requestId,
    pairingKey: message.pairingKey,
    action: message.action
  });
});

postToPage("BRIDGE_READY", bridgeInfo());
