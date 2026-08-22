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
const cloudKeyEl = document.getElementById("cloudKey");
const cloudKeyInput = document.getElementById("cloudKeyInput");
const cloudWorkspaceNameEl = document.getElementById("cloudWorkspaceName");
const copyCloudKeyBtn = document.getElementById("copyCloudKey");
const connectCloudBtn = document.getElementById("connectCloud");
const createCloudBtn = document.getElementById("createCloud");
const disconnectCloudBtn = document.getElementById("disconnectCloud");

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

async function copyText(value, button) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = original), 1200);
  } catch (_) {}
}

async function refreshStatus() {
  const response = await send("GET_STATUS");
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Không đọc được trạng thái.";
    return;
  }
  const id = response.result.loggedInUserId;
  statusEl.textContent = id
    ? `Phiên Instagram sẵn sàng · viewer ID ${id}`
    : "Chưa nhận diện được phiên Instagram đang đăng nhập.";
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
    return;
  }

  const config = response.result;
  if (!config.configured) {
    cloudStateEl.textContent = "Not configured";
    cloudStateEl.className = "state-pill";
    cloudConnectedEl.classList.add("hidden");
    cloudSetupEl.classList.remove("hidden");
    cloudKeyEl.textContent = "—";
    return;
  }

  cloudConnectedEl.classList.remove("hidden");
  cloudSetupEl.classList.add("hidden");
  cloudKeyEl.textContent = config.workspaceKey || "—";
  cloudWorkspaceNameEl.textContent = config.workspace
    ? `${config.workspace.name} · ${config.workspace.id}`
    : (config.error || "Workspace key đã lưu nhưng backend chưa xác nhận.");
  cloudStateEl.textContent = config.error ? "Degraded" : "Connected";
  cloudStateEl.className = `state-pill ${config.error ? "bad" : "ok"}`;
}

copyKeyBtn.addEventListener("click", () => copyText(pairingKeyEl.textContent.trim(), copyKeyBtn));
copyCloudKeyBtn.addEventListener("click", () => copyText(cloudKeyEl.textContent.trim(), copyCloudKeyBtn));

rotateKeyBtn.addEventListener("click", async () => {
  const confirmed = confirm("Tạo pairing key mới? Website đang kết nối bằng key cũ sẽ mất quyền truy cập.");
  if (!confirmed) return;
  const response = await send("ROTATE_PAIRING_KEY");
  pairingKeyEl.textContent = response?.ok ? response.result.pairingKey : "Không tạo được key";
});

createCloudBtn.addEventListener("click", async () => {
  createCloudBtn.disabled = true;
  createCloudBtn.textContent = "Creating…";
  const response = await send("CREATE_CLOUD_WORKSPACE", { name: "QuetUnfollowIG Workspace" });
  createCloudBtn.disabled = false;
  createCloudBtn.textContent = "Create new";
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Không tạo được Cloud Workspace.";
    return;
  }
  await refreshCloud();
  statusEl.textContent = "Cloud Workspace đã tạo. Hãy copy Cloud Workspace Key để dùng trên thiết bị khác.";
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
  statusEl.textContent = "Đã kết nối Cloud Workspace. History/diff sẽ dùng chung trên thiết bị này.";
});

disconnectCloudBtn.addEventListener("click", async () => {
  const confirmed = confirm("Ngắt Cloud Workspace trên thiết bị này? Dữ liệu trên Supabase không bị xóa.");
  if (!confirmed) return;
  await send("DISCONNECT_CLOUD_WORKSPACE");
  await refreshCloud();
});

crawlBtn.addEventListener("click", async () => {
  const targetUsername = targetInput.value.trim();
  crawlBtn.disabled = true;
  crawlBtn.textContent = "Crawling + syncing…";
  statusEl.textContent = targetUsername
    ? `Đang resolve, crawl và commit ${targetUsername.startsWith("@") ? targetUsername : `@${targetUsername}`} lên Supabase…`
    : "Đang crawl và commit tài khoản Instagram hiện tại lên Supabase…";

  const response = targetUsername
    ? await send("CRAWL_TARGET", { targetUsername })
    : await send("CRAWL_NOW");

  if (!response?.ok) {
    statusEl.textContent = response?.error || "Crawl thất bại.";
    crawlBtn.disabled = false;
    crawlBtn.textContent = "Crawl target → Supabase";
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
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

refreshStatus();
refreshPairingKey();
refreshCloud();
