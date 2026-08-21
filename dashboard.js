const STORAGE_KEY = "quetUnfollowIGState";

const $ = (id) => document.getElementById(id);
const els = {
  accountStatus: $("accountStatus"),
  crawlBtn: $("crawlBtn"),
  emptyCrawlBtn: $("emptyCrawlBtn"),
  resetBaselineBtn: $("resetBaselineBtn"),
  exportBtn: $("exportBtn"),
  importInput: $("importInput"),
  progressBox: $("progressBox"),
  progressTitle: $("progressTitle"),
  progressText: $("progressText"),
  emptyState: $("emptyState"),
  dashboardContent: $("dashboardContent"),
  followersCount: $("followersCount"),
  followingCount: $("followingCount"),
  followersDelta: $("followersDelta"),
  followingDelta: $("followingDelta"),
  lostFollowersCount: $("lostFollowersCount"),
  unfollowedCount: $("unfollowedCount"),
  baselineMode: $("baselineMode"),
  previousMode: $("previousMode"),
  searchInput: $("searchInput"),
  comparisonMeta: $("comparisonMeta"),
  lostFollowersList: $("lostFollowersList"),
  unfollowedList: $("unfollowedList"),
  newFollowersList: $("newFollowersList"),
  newFollowingList: $("newFollowingList"),
  lostBadge: $("lostBadge"),
  unfollowedBadge: $("unfollowedBadge"),
  newFollowersBadge: $("newFollowersBadge"),
  newFollowingBadge: $("newFollowingBadge"),
  historyBody: $("historyBody"),
  historyCount: $("historyCount")
};

let comparisonMode = "baseline";
let currentAccount = null;
let currentDiff = null;

function send(type) {
  return chrome.runtime.sendMessage({ type });
}

function userKey(user) {
  return user?.id ? `id:${user.id}` : `username:${String(user?.username || "").toLowerCase()}`;
}

function listDiff(before = [], after = []) {
  const beforeMap = new Map(before.map((user) => [userKey(user), user]));
  const afterMap = new Map(after.map((user) => [userKey(user), user]));
  return {
    removed: [...beforeMap].filter(([key]) => !afterMap.has(key)).map(([, user]) => user),
    added: [...afterMap].filter(([key]) => !beforeMap.has(key)).map(([, user]) => user)
  };
}

function buildDiff(reference, latest) {
  const followers = listDiff(reference?.followers, latest?.followers);
  const following = listDiff(reference?.following, latest?.following);
  return {
    lostFollowers: followers.removed,
    newFollowers: followers.added,
    unfollowed: following.removed,
    newFollowing: following.added
  };
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(iso));
}

function deltaText(value) {
  if (value === 0) return "±0 so với mốc";
  return `${value > 0 ? "+" : ""}${value} so với mốc`;
}

function getReference(account) {
  const snapshots = account?.snapshots || [];
  if (comparisonMode === "previous" && snapshots.length > 1) {
    return snapshots.at(-2);
  }
  return account?.baseline || snapshots[0] || null;
}

function personMatches(user, query) {
  if (!query) return true;
  const haystack = `${user.username || ""} ${user.fullName || ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function createPersonRow(user) {
  const row = document.createElement("div");
  row.className = "person";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = (user.username || "?").slice(0, 1).toUpperCase();

  const identity = document.createElement("div");
  identity.className = "identity";

  const username = document.createElement("a");
  username.className = "username";
  username.textContent = `@${user.username || "unknown"}`;
  if (user.username) {
    username.href = `https://www.instagram.com/${encodeURIComponent(user.username)}/`;
    username.target = "_blank";
    username.rel = "noreferrer";
  }

  const fullName = document.createElement("span");
  fullName.className = "full-name";
  fullName.textContent = user.fullName || `Instagram ID ${user.id || "—"}`;

  identity.append(username, fullName);
  row.append(avatar, identity);

  if (user.isVerified) {
    const verified = document.createElement("span");
    verified.className = "verified";
    verified.textContent = "Verified";
    row.append(verified);
  }

  return row;
}

function renderPeople(container, users) {
  container.replaceChildren();
  const query = els.searchInput.value.trim();
  const filtered = users.filter((user) => personMatches(user, query));

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = query ? "Không có kết quả phù hợp." : "Không có thay đổi.";
    container.append(empty);
    return;
  }

  for (const user of filtered) container.append(createPersonRow(user));
}

function renderHistory(account) {
  const history = [...(account.snapshots || [])].reverse();
  els.historyBody.replaceChildren();
  els.historyCount.textContent = String(history.length);

  for (const snapshot of history) {
    const tr = document.createElement("tr");
    const values = [
      formatDate(snapshot.crawledAt),
      snapshot.counts?.followers ?? snapshot.followers?.length ?? 0,
      snapshot.counts?.following ?? snapshot.following?.length ?? 0,
      snapshot.id?.slice(0, 12) || "—"
    ];
    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    }
    els.historyBody.append(tr);
  }
}

function renderAccount(account) {
  currentAccount = account;
  const latest = account.snapshots?.at(-1);
  const reference = getReference(account);
  if (!latest || !reference) return;

  currentDiff = buildDiff(reference, latest);
  const followerCount = latest.counts?.followers ?? latest.followers.length;
  const followingCount = latest.counts?.following ?? latest.following.length;
  const referenceFollowerCount = reference.counts?.followers ?? reference.followers.length;
  const referenceFollowingCount = reference.counts?.following ?? reference.following.length;

  els.followersCount.textContent = followerCount.toLocaleString("vi-VN");
  els.followingCount.textContent = followingCount.toLocaleString("vi-VN");
  els.followersDelta.textContent = deltaText(followerCount - referenceFollowerCount);
  els.followingDelta.textContent = deltaText(followingCount - referenceFollowingCount);
  els.lostFollowersCount.textContent = currentDiff.lostFollowers.length.toLocaleString("vi-VN");
  els.unfollowedCount.textContent = currentDiff.unfollowed.length.toLocaleString("vi-VN");

  els.lostBadge.textContent = String(currentDiff.lostFollowers.length);
  els.unfollowedBadge.textContent = String(currentDiff.unfollowed.length);
  els.newFollowersBadge.textContent = String(currentDiff.newFollowers.length);
  els.newFollowingBadge.textContent = String(currentDiff.newFollowing.length);

  renderPeople(els.lostFollowersList, currentDiff.lostFollowers);
  renderPeople(els.unfollowedList, currentDiff.unfollowed);
  renderPeople(els.newFollowersList, currentDiff.newFollowers);
  renderPeople(els.newFollowingList, currentDiff.newFollowing);
  renderHistory(account);

  const label = comparisonMode === "previous" && account.snapshots.length > 1
    ? "snapshot trước"
    : "baseline đầu tiên";
  els.comparisonMeta.textContent = `Đang so snapshot ${formatDate(latest.crawledAt)} với ${label} · ${formatDate(reference.crawledAt)}`;
}

function setMode(mode) {
  comparisonMode = mode;
  els.baselineMode.classList.toggle("active", mode === "baseline");
  els.previousMode.classList.toggle("active", mode === "previous");
  if (currentAccount) renderAccount(currentAccount);
}

function setBusy(busy) {
  els.crawlBtn.disabled = busy;
  els.emptyCrawlBtn.disabled = busy;
  els.crawlBtn.textContent = busy ? "Đang crawl…" : "Crawl now";
  els.progressBox.classList.toggle("hidden", !busy);
}

async function refresh() {
  const response = await send("GET_STATUS");
  if (!response?.ok) {
    els.accountStatus.textContent = response?.error || "Không đọc được trạng thái extension.";
    return;
  }

  const { loggedInUserId, state } = response.result;
  if (!loggedInUserId) {
    els.accountStatus.textContent = "Chưa nhận diện được phiên Instagram. Hãy đăng nhập instagram.com trong cùng trình duyệt.";
    els.dashboardContent.classList.add("hidden");
    els.emptyState.classList.remove("hidden");
    return;
  }

  els.accountStatus.textContent = `Instagram account ID ${loggedInUserId} · local-only storage`;
  const account = state.accounts?.[loggedInUserId];
  if (!account?.snapshots?.length) {
    currentAccount = null;
    els.dashboardContent.classList.add("hidden");
    els.emptyState.classList.remove("hidden");
    return;
  }

  els.emptyState.classList.add("hidden");
  els.dashboardContent.classList.remove("hidden");
  renderAccount(account);
}

async function crawl() {
  setBusy(true);
  els.progressTitle.textContent = "Đang crawl Instagram";
  els.progressText.textContent = "Bắt đầu với Followers…";
  try {
    const response = await send("CRAWL_NOW");
    if (!response?.ok) throw new Error(response?.error || "Crawl thất bại.");
    await refresh();
  } catch (error) {
    els.progressTitle.textContent = "Crawl thất bại";
    els.progressText.textContent = error.message;
    setTimeout(() => els.progressBox.classList.add("hidden"), 5000);
  } finally {
    setBusy(false);
  }
}

async function resetBaseline() {
  if (!currentAccount?.snapshots?.length) return;
  const latest = currentAccount.snapshots.at(-1);
  const confirmed = confirm(`Đặt snapshot ${formatDate(latest.crawledAt)} làm baseline mới? Baseline cũ sẽ bị thay thế.`);
  if (!confirmed) return;
  const response = await send("RESET_BASELINE");
  if (!response?.ok) {
    alert(response?.error || "Không thể reset baseline.");
    return;
  }
  setMode("baseline");
  await refresh();
}

async function exportBackup() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const payload = data[STORAGE_KEY];
  if (!payload) {
    alert("Chưa có dữ liệu để export.");
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quet-unfollow-ig-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.schemaVersion !== 1 || !parsed?.accounts || typeof parsed.accounts !== "object") {
      throw new Error("File không đúng schema backup của QuetUnfollowIG.");
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: parsed });
    await refresh();
  } catch (error) {
    alert(`Import thất bại: ${error.message}`);
  } finally {
    els.importInput.value = "";
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "CRAWL_PROGRESS") return;
  const { kind, loaded, page } = message.payload || {};
  const label = kind === "following" ? "Following" : "Followers";
  els.progressTitle.textContent = `Đang tải ${label}`;
  els.progressText.textContent = page ? `Đã nhận ${loaded.toLocaleString("vi-VN")} tài khoản · page ${page}` : `Chuẩn bị ${label}…`;
  els.progressBox.classList.remove("hidden");
});

els.crawlBtn.addEventListener("click", crawl);
els.emptyCrawlBtn.addEventListener("click", crawl);
els.resetBaselineBtn.addEventListener("click", resetBaseline);
els.exportBtn.addEventListener("click", exportBackup);
els.importInput.addEventListener("change", (event) => importBackup(event.target.files?.[0]));
els.baselineMode.addEventListener("click", () => setMode("baseline"));
els.previousMode.addEventListener("click", () => setMode("previous"));
els.searchInput.addEventListener("input", () => currentAccount && renderAccount(currentAccount));

refresh();
