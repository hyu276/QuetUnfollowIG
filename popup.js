const statusEl = document.getElementById("status");
const crawlBtn = document.getElementById("crawl");
const dashboardBtn = document.getElementById("dashboard");

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
