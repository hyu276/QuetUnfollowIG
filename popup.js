const statusEl = document.getElementById("status");
const crawlBtn = document.getElementById("crawl");
const dashboardBtn = document.getElementById("dashboard");
const pairingKeyEl = document.getElementById("pairingKey");
const copyKeyBtn = document.getElementById("copyKey");
const rotateKeyBtn = document.getElementById("rotateKey");

function send(type) {
  return chrome.runtime.sendMessage({ type });
}

async function refreshStatus() {
  const response = await send("GET_STATUS");
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Không đọc được trạng thái.";
    return;
  }
  const id = response.result.loggedInUserId;
  statusEl.textContent = id
    ? `Đã nhận diện phiên Instagram · ID ${id}`
    : "Chưa nhận diện được phiên Instagram đang đăng nhập.";
}

async function refreshPairingKey() {
  const response = await send("GET_PAIRING_KEY");
  pairingKeyEl.textContent = response?.ok ? response.result.pairingKey : "Không tạo được key";
}

copyKeyBtn.addEventListener("click", async () => {
  const key = pairingKeyEl.textContent.trim();
  if (!key || key.includes("Không")) return;
  try {
    await navigator.clipboard.writeText(key);
    copyKeyBtn.textContent = "Copied";
    setTimeout(() => (copyKeyBtn.textContent = "Copy"), 1200);
  } catch (_) {
    const range = document.createRange();
    range.selectNodeContents(pairingKeyEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

rotateKeyBtn.addEventListener("click", async () => {
  const confirmed = confirm("Tạo pairing key mới? Website đang kết nối bằng key cũ sẽ mất quyền truy cập.");
  if (!confirmed) return;
  const response = await send("ROTATE_PAIRING_KEY");
  pairingKeyEl.textContent = response?.ok ? response.result.pairingKey : "Không tạo được key";
});

crawlBtn.addEventListener("click", async () => {
  crawlBtn.disabled = true;
  crawlBtn.textContent = "Đang crawl…";
  statusEl.textContent = "Đang tải Followers rồi Following. Có thể mất một lúc nếu danh sách lớn.";
  const response = await send("CRAWL_NOW");
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Crawl thất bại.";
    crawlBtn.disabled = false;
    crawlBtn.textContent = "Crawl ngay";
    return;
  }
  statusEl.textContent = `Xong · ${response.result.snapshot.counts.followers} followers · ${response.result.snapshot.counts.following} following`;
  crawlBtn.disabled = false;
  crawlBtn.textContent = "Crawl lại";
});

dashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

refreshStatus();
refreshPairingKey();
