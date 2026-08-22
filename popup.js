const MAIN_SITE_URL = "https://quet-unfollow-ig.vercel.app/";
const LAST_TARGET_KEY = "quetUnfollowIGLastTarget";

const statusEl = document.getElementById("status");
const crawlBtn = document.getElementById("crawl");
const dashboardBtn = document.getElementById("dashboard");
const pairingKeyEl = document.getElementById("pairingKey");
const copyKeyBtn = document.getElementById("copyKey");
const rotateKeyBtn = document.getElementById("rotateKey");
const targetInput = document.getElementById("targetUsername");
const cloudStateEl = document.getElementById("cloudState");
const cloudConnectedEl = document.getElementById("cloudConnected");
const cloudSetupEl = document.getElementById("cloudSetup");
const cloudSetupHelpEl = document.getElementById("cloudSetupHelp");
const cloudKeyEl = document.getElementById("cloudKey");
const cloudKeyInput = document.getElementById("cloudKeyInput");
const cloudWorkspaceNameEl = document.getElementById("cloudWorkspaceName");
const copyCloudKeyBtn = document.getElementById("copyCloudKey");
const connectCloudBtn = document.getElementById("connectCloud");
const createCloudBtn = document.getElementById("createCloud");
const disconnectCloudBtn = document.getElementById("disconnectCloud");

let crawlStartedFromPopup = false;

targetInput.value = localStorage.getItem(LAST_TARGET_KEY) || "";
targetInput.addEventListener("input", () => {
  localStorage.setItem(LAST_TARGET_KEY, targetInput.value.trim());
});

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

async function copyText(value, button) {
  if (!value || value === "—") return;
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = original), 1200);
  } catch (_) {
    statusEl.textContent = "Không copy được tự động. Hãy chọn và copy thủ công.";
  }
}

async function refreshStatus() {
  const response = await send("GET_STATUS");
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Không đọc được trạng thái.";
    crawlBtn.disabled = true;
    return;
  }

  const { loggedInUserId, activeCrawl } = response.result;
  if (activeCrawl) {
    crawlBtn.disabled = true;
    crawlBtn.textContent = "Crawl đang chạy…";
    const target = activeCrawl.target ? ` · ${activeCrawl.target}` : "";
    statusEl.textContent = `Một crawl đang chạy${target}. Không thể bắt đầu crawl thứ hai cùng lúc.`;
    return;
  }

  if (!crawlStartedFromPopup) {
    crawlBtn.disabled = !loggedInUserId;
    crawlBtn.textContent = "Crawl target → Supabase";
  }
  statusEl.textContent = loggedInUserId
    ? `Phiên Instagram sẵn sàng · viewer ID ${loggedInUserId}`
    : "Chưa nhận diện được phiên Instagram. Hãy đăng nhập instagram.com trong cùng trình duyệt.";
}

async function refreshPairingKey() {
  const response = await send("GET_PAIRING_KEY");
  pairingKeyEl.textContent = response?.ok ? response.result.pairingKey : "Không tạo được key";
}

async function refreshCloud() {
  cloudStateEl.textContent = "Checking";
  cloudStateEl.className = "state-pill";
  const response = await send("GET_CLOUD_CONFIG");
  if (!response?.ok) {
    cloudStateEl.textContent = "Error";
    cloudStateEl.className = "state-pill bad";
    cloudConnectedEl.classList.add("hidden");
    cloudSetupEl.classList.remove("hidden");
    cloudSetupHelpEl.textContent = response?.error || "Không kiểm tra được Cloud Workspace.";
    return;
  }

  const config = response.result;
  if (!config.configured || config.error) {
    cloudStateEl.textContent = config.code === "WORKSPACE_ALREADY_EXISTS" ? "Key required" : (config.error ? "Setup needed" : "Not configured");
    cloudStateEl.className = `state-pill ${config.error ? "bad" : ""}`;
    cloudConnectedEl.classList.add("hidden");
    cloudSetupEl.classList.remove("hidden");
    cloudKeyEl.textContent = "—";

    const workspaceExists = config.code === "WORKSPACE_ALREADY_EXISTS";
    createCloudBtn.disabled = workspaceExists;
    createCloudBtn.textContent = workspaceExists ? "Use existing key" : "Create new";
    cloudSetupHelpEl.textContent = workspaceExists
      ? "Workspace đã tồn tại. Hãy copy Cloud Workspace Key từ thiết bị đã setup và paste vào ô bên trên."
      : (config.error || "Thiết bị đầu tiên có thể tạo workspace; thiết bị khác nên connect workspace hiện có.");
    return;
  }

  createCloudBtn.disabled = false;
  createCloudBtn.textContent = "Create new";
  cloudConnectedEl.classList.remove("hidden");
  cloudSetupEl.classList.add("hidden");
  cloudKeyEl.textContent = config.workspaceKey || "—";
  cloudWorkspaceNameEl.textContent = config.workspace
    ? `${config.workspace.name} · ${config.workspace.id}`
    : "Workspace key đã lưu nhưng backend chưa trả metadata.";
  cloudStateEl.textContent = "Connected";
  cloudStateEl.className = "state-pill ok";
}

copyKeyBtn.addEventListener("click", () => copyText(pairingKeyEl.textContent.trim(), copyKeyBtn));
copyCloudKeyBtn.addEventListener("click", () => copyText(cloudKeyEl.textContent.trim(), copyCloudKeyBtn));

rotateKeyBtn.addEventListener("click", async () => {
  const confirmed = confirm("Tạo pairing key mới? Main site đang dùng key cũ sẽ mất quyền truy cập cho tới khi bạn paste key mới.");
  if (!confirmed) return;
  const response = await send("ROTATE_PAIRING_KEY");
  pairingKeyEl.textContent = response?.ok ? response.result.pairingKey : "Không tạo được key";
});

createCloudBtn.addEventListener("click", async () => {
  createCloudBtn.disabled = true;
  createCloudBtn.textContent = "Creating…";
  const response = await send("CREATE_CLOUD_WORKSPACE", { name: "QuetUnfollowIG Workspace" });
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Không tạo được Cloud Workspace.";
    await refreshCloud();
    return;
  }
  await refreshCloud();
  statusEl.textContent = "Cloud Workspace đã tạo. Nên backup Cloud Workspace Key để dùng trên thiết bị khác.";
});

connectCloudBtn.addEventListener("click", async () => {
  const workspaceKey = cloudKeyInput.value.trim();
  if (!workspaceKey) {
    statusEl.textContent = "Paste Cloud Workspace Key trước khi connect.";
    return;
  }
  connectCloudBtn.disabled = true;
  connectCloudBtn.textContent = "Connecting…";
  const response = await send("CONNECT_CLOUD_WORKSPACE", { workspaceKey });
  connectCloudBtn.disabled = false;
  connectCloudBtn.textContent = "Connect existing";
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Cloud Workspace Key không hợp lệ.";
    return;
  }
  cloudKeyInput.value = "";
  await refreshCloud();
  statusEl.textContent = "Đã kết nối Cloud Workspace. History/diff trên thiết bị này sẽ dùng chung cloud data.";
});

disconnectCloudBtn.addEventListener("click", async () => {
  const confirmed = confirm(
    "Ngắt Cloud Workspace trên thiết bị này? Hãy chắc rằng bạn đã lưu Cloud Workspace Key; nếu mất key, thiết bị này không thể tự khôi phục history cloud hiện có."
  );
  if (!confirmed) return;
  await send("DISCONNECT_CLOUD_WORKSPACE");
  await refreshCloud();
});

crawlBtn.addEventListener("click", async () => {
  const targetUsername = targetInput.value.trim();
  localStorage.setItem(LAST_TARGET_KEY, targetUsername);
  crawlStartedFromPopup = true;
  crawlBtn.disabled = true;
  crawlBtn.textContent = "Crawling + syncing…";
  statusEl.textContent = targetUsername
    ? `Đang resolve, crawl và commit ${targetUsername.startsWith("@") ? targetUsername : `@${targetUsername}`} lên Supabase…`
    : "Đang crawl và commit tài khoản Instagram hiện tại lên Supabase…";

  const response = targetUsername
    ? await send("CRAWL_TARGET", { targetUsername })
    : await send("CRAWL_NOW");

  crawlStartedFromPopup = false;
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Crawl thất bại.";
    await refreshStatus();
    return;
  }

  const { snapshot, target, cloud } = response.result;
  const label = target?.username ? `@${target.username}` : `ID ${target?.id || snapshot.accountId}`;
  const diff = cloud?.diffSummary;
  const suffix = diff?.previousRunId
    ? ` · lost ${diff.lostFollowers || 0} · new ${diff.newFollowers || 0}`
    : " · cloud baseline created";
  statusEl.textContent = `Cloud committed ${label} · ${snapshot.counts.followers} followers · ${snapshot.counts.following} following${suffix}`;
  crawlBtn.disabled = false;
  crawlBtn.textContent = "Crawl lại target → Supabase";
});

dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: MAIN_SITE_URL });
});

refreshStatus();
refreshPairingKey();
refreshCloud();
const statusTimer = setInterval(() => refreshStatus().catch(() => {}), 2500);
window.addEventListener("unload", () => clearInterval(statusTimer));
