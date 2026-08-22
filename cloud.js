const CLOUD_WORKSPACE_KEY_STORAGE = "quetUnfollowIGCloudWorkspaceKey";
const CLOUD_CLIENT_ID_STORAGE = "quetUnfollowIGCloudClientId";
const CLOUD_API_URL = "https://zkrhwqgmynbbmoktokdq.supabase.co/functions/v1/ig-cloud";
const CLOUD_CHUNK_SIZE = 250;

let cloudProvisionPromise = null;

function makeCloudSecret(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getCloudWorkspaceKey() {
  const stored = await chrome.storage.local.get(CLOUD_WORKSPACE_KEY_STORAGE);
  return String(stored[CLOUD_WORKSPACE_KEY_STORAGE] || "").trim();
}

async function setCloudWorkspaceKey(key) {
  const value = String(key || "").trim();
  if (!value) await chrome.storage.local.remove(CLOUD_WORKSPACE_KEY_STORAGE);
  else await chrome.storage.local.set({ [CLOUD_WORKSPACE_KEY_STORAGE]: value });
}

async function getCloudClientId() {
  const stored = await chrome.storage.local.get(CLOUD_CLIENT_ID_STORAGE);
  if (stored[CLOUD_CLIENT_ID_STORAGE]) return stored[CLOUD_CLIENT_ID_STORAGE];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [CLOUD_CLIENT_ID_STORAGE]: id });
  return id;
}

async function cloudCall(action, payload = {}, options = {}) {
  const key = String(options.workspaceKey || await getCloudWorkspaceKey()).trim();
  if (action !== "create_workspace" && !key) {
    throw new Error("Cloud Workspace chưa được cấu hình. Mở extension popup để tạo hoặc nhập Cloud Workspace Key.");
  }

  const headers = { "Content-Type": "application/json" };
  if (action !== "create_workspace") headers["X-Workspace-Key"] = key;
  const body = action === "create_workspace"
    ? { action, workspaceKey: key, ...payload }
    : { action, ...payload };

  let lastError = null;
  const attempts = options.attempts || 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(CLOUD_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        cache: "no-store"
      });
      let data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok || data?.ok === false) {
        const error = new Error(data?.error || `Cloud API HTTP ${response.status}`);
        error.status = response.status;
        error.code = data?.code || "CLOUD_API_ERROR";
        if (response.status >= 400 && response.status < 500) throw error;
        lastError = error;
      } else {
        return data;
      }
    } catch (error) {
      lastError = error;
      if (error?.status >= 400 && error.status < 500) throw error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw lastError || new Error("Không kết nối được Supabase cloud backend.");
}

async function cloudCreateWorkspace(name = "QuetUnfollowIG Workspace") {
  const workspaceKey = makeCloudSecret(32);
  const result = await cloudCall("create_workspace", { name }, { workspaceKey, attempts: 2 });
  await setCloudWorkspaceKey(workspaceKey);
  return { workspaceKey, workspace: result.workspace, created: result.created };
}

async function cloudConnectWorkspace(workspaceKey) {
  const key = String(workspaceKey || "").trim();
  if (key.length < 32) throw new Error("Cloud Workspace Key không hợp lệ.");
  const result = await cloudCall("ping", {}, { workspaceKey: key, attempts: 2 });
  await setCloudWorkspaceKey(key);
  return result;
}

async function cloudDisconnectWorkspace() {
  await setCloudWorkspaceKey("");
  return { configured: false };
}

async function autoProvisionCloudWorkspace() {
  if (cloudProvisionPromise) return cloudProvisionPromise;
  cloudProvisionPromise = cloudCreateWorkspace("QuetUnfollowIG Workspace")
    .finally(() => { cloudProvisionPromise = null; });
  return cloudProvisionPromise;
}

async function cloudGetConfig() {
  let key = await getCloudWorkspaceKey();

  if (!key) {
    try {
      const created = await autoProvisionCloudWorkspace();
      key = created.workspaceKey;
      return {
        configured: true,
        workspace: created.workspace,
        workspaceKey: key,
        maskedKey: `${key.slice(0, 8)}…${key.slice(-6)}`,
        autoProvisioned: true
      };
    } catch (error) {
      const existingHint = error?.code === "WORKSPACE_ALREADY_EXISTS"
        ? " Workspace đã tồn tại trên thiết bị khác: hãy copy Cloud Workspace Key từ thiết bị đó và chọn Connect existing."
        : "";
      return {
        configured: false,
        workspace: null,
        maskedKey: "",
        code: error?.code || "AUTO_PROVISION_FAILED",
        error: `Không thể tự khởi tạo Cloud Workspace.${existingHint} ${error?.message || String(error)}`.trim()
      };
    }
  }

  try {
    const result = await cloudCall("ping", {}, { workspaceKey: key, attempts: 1 });
    return {
      configured: true,
      workspace: result.workspace,
      workspaceKey: key,
      maskedKey: `${key.slice(0, 8)}…${key.slice(-6)}`,
      autoProvisioned: false
    };
  } catch (error) {
    return {
      configured: true,
      workspace: null,
      workspaceKey: key,
      maskedKey: `${key.slice(0, 8)}…${key.slice(-6)}`,
      code: error?.code || "WORKSPACE_UNREACHABLE",
      error: error?.message || String(error)
    };
  }
}

async function cloudRequireWorkspace() {
  let key = await getCloudWorkspaceKey();
  if (key) return key;

  const config = await cloudGetConfig();
  key = await getCloudWorkspaceKey();
  if (config.configured && !config.error && key) return key;
  throw new Error(config.error || "Cloud Workspace chưa được cấu hình. Hãy tạo workspace hoặc nhập key từ thiết bị khác trước khi crawl.");
}

async function cloudListTargets() {
  return cloudCall("list_targets");
}

async function cloudGetTargetStatus(targetIgId) {
  if (!targetIgId) return null;
  return cloudCall("target_status", { targetIgId: String(targetIgId) });
}

function cloudChunks(items, size = CLOUD_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function cloudUploadRelation(runId, relation, users) {
  const chunks = cloudChunks(users);
  let uploaded = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const result = await cloudCall("upload_chunk", {
      runId,
      relation,
      users: chunks[index]
    });
    uploaded += Number(result.uploaded || 0);
    try {
      await chrome.runtime.sendMessage({
        type: "CLOUD_SYNC_PROGRESS",
        payload: {
          phase: "upload",
          relation,
          uploaded,
          total: users.length,
          chunk: index + 1,
          chunks: chunks.length
        }
      });
    } catch (_) {}
  }
  return uploaded;
}

async function cloudSyncSnapshot(snapshot, target, viewerId, sourceVersion = "unknown") {
  await cloudRequireWorkspace();
  const clientInstanceId = await getCloudClientId();
  const startedAt = new Date(
    new Date(snapshot.crawledAt).getTime() - Number(snapshot.durationMs || 0)
  ).toISOString();

  const start = await cloudCall("start_run", {
    snapshotId: snapshot.id,
    capturedAt: snapshot.crawledAt,
    target: {
      id: target.id,
      username: target.username || target.id,
      fullName: target.fullName || "",
      isPrivate: Boolean(target.isPrivate),
      resolver: target.resolver || null,
      viewerFollowsTarget: target.viewerFollows ?? null,
      targetFollowsViewer: target.followsViewer ?? null,
      expectedFollowers: target.expectedFollowers,
      expectedFollowing: target.expectedFollowing
    },
    viewer: { id: viewerId },
    counts: snapshot.counts,
    durationMs: snapshot.durationMs,
    startedAt,
    clientInstanceId,
    sourceVersion
  });

  const run = start.run;
  if (run?.is_complete) {
    const status = await cloudGetTargetStatus(target.id);
    return { run, status, reused: true };
  }

  await cloudUploadRelation(run.id, "followers", snapshot.followers || []);
  await cloudUploadRelation(run.id, "following", snapshot.following || []);
  const finalized = await cloudCall("finalize_run", { runId: run.id }, { attempts: 2 });
  return {
    run: finalized.run,
    diffSummary: finalized.diffSummary,
    changes: finalized.changes,
    reused: Boolean(finalized.alreadyComplete)
  };
}
