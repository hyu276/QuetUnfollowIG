"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type IGUser = {
  id: string;
  username: string;
  fullName: string;
  isPrivate: boolean;
  isVerified: boolean;
};

type Snapshot = {
  id: string;
  accountId: string;
  crawledAt: string;
  durationMs?: number;
  followers: IGUser[];
  following: IGUser[];
  counts: { followers: number; following: number };
};

type SnapshotSummary = {
  id: string;
  crawledAt: string;
  durationMs?: number;
  counts: { followers: number; following: number };
};

type WebAccount = {
  accountId: string;
  baseline: Snapshot | null;
  latest: Snapshot | null;
  history: SnapshotSummary[];
  snapshotCount: number;
};

type StatusResult = {
  loggedInUserId: string | null;
  account: WebAccount | null;
};

type ProgressEvent = {
  kind: "followers" | "following";
  loaded: number;
  page: number;
  elapsedMs?: number;
  pageLatencyMs?: number;
  hasNextPage?: boolean;
  at?: string;
};

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const SOURCE = "quet-unfollow-ig-web";

function userKey(user: IGUser) {
  return user.id ? `id:${user.id}` : `username:${user.username.toLowerCase()}`;
}

function diffUsers(before: IGUser[] = [], after: IGUser[] = []) {
  const beforeMap = new Map(before.map((user) => [userKey(user), user]));
  const afterMap = new Map(after.map((user) => [userKey(user), user]));
  return {
    removed: [...beforeMap].filter(([key]) => !afterMap.has(key)).map(([, user]) => user),
    added: [...afterMap].filter(([key]) => !beforeMap.has(key)).map(([, user]) => user)
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value || 0);
}

function formatDuration(ms?: number) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function uniqueCount(users: IGUser[]) {
  return new Set(users.map(userKey)).size;
}

export default function Home() {
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeVersion, setBridgeVersion] = useState<string>("—");
  const [pairingKey, setPairingKey] = useState("");
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [logs, setLogs] = useState<ProgressEvent[]>([]);
  const pending = useRef(new Map<string, PendingRequest>());

  useEffect(() => {
    const saved = window.localStorage.getItem("quet-unfollow-pairing-key");
    if (saved) setPairingKey(saved);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source !== SOURCE) return;

      if (message.type === "BRIDGE_READY") {
        setBridgeReady(true);
        setBridgeVersion(message.version || "unknown");
        return;
      }

      if (message.type === "BRIDGE_DISCONNECTED") {
        setBridgeReady(false);
        setError(message.error || "Extension bridge disconnected.");
        return;
      }

      if (message.type === "CRAWL_PROGRESS") {
        const payload = message.payload as ProgressEvent;
        setProgress(payload);
        setLogs((items) => [...items.slice(-199), payload]);
        return;
      }

      if (message.type === "WEB_RESPONSE") {
        const request = pending.current.get(message.requestId);
        if (!request) return;
        clearTimeout(request.timeout);
        pending.current.delete(message.requestId);
        if (message.ok) request.resolve(message.result);
        else request.reject(new Error(message.error || "Unknown bridge error"));
      }
    };

    window.addEventListener("message", onMessage);
    window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin);
    const retry = window.setTimeout(() => {
      window.postMessage({ source: SOURCE, type: "BRIDGE_PING" }, window.location.origin);
    }, 700);

    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("message", onMessage);
      for (const request of pending.current.values()) clearTimeout(request.timeout);
      pending.current.clear();
    };
  }, []);

  function request<T>(action: "GET_STATUS" | "CRAWL_NOW", key = pairingKey) {
    return new Promise<T>((resolve, reject) => {
      if (!bridgeReady) {
        reject(new Error("Không phát hiện extension bridge. Hãy reload extension và reload website."));
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("Bridge request timeout."));
      }, action === "CRAWL_NOW" ? 20 * 60_000 : 15_000);

      pending.current.set(requestId, { resolve, reject, timeout });
      window.postMessage(
        { source: SOURCE, type: "WEB_REQUEST", requestId, pairingKey: key.trim(), action },
        window.location.origin
      );
    });
  }

  async function connect() {
    setError("");
    const key = pairingKey.trim();
    if (!key) {
      setError("Nhập pairing key từ popup extension trước.");
      return;
    }
    try {
      window.localStorage.setItem("quet-unfollow-pairing-key", key);
      const result = await request<StatusResult>("GET_STATUS", key);
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function crawl() {
    setError("");
    setBusy(true);
    setLogs([]);
    setProgress({ kind: "followers", loaded: 0, page: 0, elapsedMs: 0 });
    try {
      await request<{ snapshot: Snapshot }>("CRAWL_NOW");
      const refreshed = await request<StatusResult>("GET_STATUS");
      setStatus(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const account = status?.account || null;
  const latest = account?.latest || null;
  const baseline = account?.baseline || null;

  const diff = useMemo(() => {
    if (!latest || !baseline) return null;
    const followers = diffUsers(baseline.followers, latest.followers);
    const following = diffUsers(baseline.following, latest.following);
    return {
      lostFollowers: followers.removed,
      newFollowers: followers.added,
      unfollowed: following.removed,
      newFollowing: following.added
    };
  }, [latest, baseline]);

  const validations = useMemo(() => {
    if (!latest) return [];
    return [
      {
        label: "Follower count khớp array",
        ok: latest.counts.followers === latest.followers.length,
        detail: `${latest.counts.followers} / ${latest.followers.length}`
      },
      {
        label: "Following count khớp array",
        ok: latest.counts.following === latest.following.length,
        detail: `${latest.counts.following} / ${latest.following.length}`
      },
      {
        label: "Followers không duplicate",
        ok: uniqueCount(latest.followers) === latest.followers.length,
        detail: `${uniqueCount(latest.followers)} unique`
      },
      {
        label: "Following không duplicate",
        ok: uniqueCount(latest.following) === latest.following.length,
        detail: `${uniqueCount(latest.following)} unique`
      },
      {
        label: "Baseline tồn tại",
        ok: Boolean(baseline),
        detail: baseline ? formatDate(baseline.crawledAt) : "missing"
      },
      {
        label: "Có Instagram account ID",
        ok: Boolean(latest.accountId),
        detail: latest.accountId || "missing"
      }
    ];
  }, [latest, baseline]);

  const passCount = validations.filter((item) => item.ok).length;
  const sampleFollowers = latest?.followers.slice(0, 12) || [];
  const sampleFollowing = latest?.following.slice(0, 12) || [];

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">LIVE CRAWLER VALIDATION CONSOLE</div>
          <h1>QuetUnfollowIG</h1>
          <p className="lede">
            Website này không crawl Instagram trực tiếp. Nó điều khiển extension đang dùng chính session Instagram trong browser,
            rồi hiển thị progress và snapshot để kiểm chứng crawler thật.
          </p>
        </div>
        <div className={`bridge-pill ${bridgeReady ? "ok" : "bad"}`}>
          <span className="status-dot" />
          {bridgeReady ? `Extension bridge v${bridgeVersion}` : "Extension bridge chưa phát hiện"}
        </div>
      </header>

      <section className="connect-card panel">
        <div>
          <span className="section-kicker">PAIRING</span>
          <h2>Kết nối live website với extension</h2>
          <p>Copy pairing key từ popup extension. Key chỉ được lưu trong localStorage của browser này.</p>
        </div>
        <div className="connect-row">
          <input
            value={pairingKey}
            onChange={(event) => setPairingKey(event.target.value)}
            placeholder="Paste pairing key…"
            spellCheck={false}
          />
          <button onClick={connect} disabled={!bridgeReady}>Connect</button>
          <button className="primary" onClick={crawl} disabled={!status?.loggedInUserId || busy}>
            {busy ? "Crawling…" : "Run live crawl"}
          </button>
        </div>
        {error ? <div className="error-box">{error}</div> : null}
      </section>

      <section className="metric-grid">
        <article className="metric panel">
          <span>Instagram session</span>
          <strong>{status?.loggedInUserId ? "Detected" : "—"}</strong>
          <small>{status?.loggedInUserId ? `ID ${status.loggedInUserId}` : "Connect để kiểm tra"}</small>
        </article>
        <article className="metric panel">
          <span>Followers</span>
          <strong>{latest ? formatNumber(latest.counts.followers) : "—"}</strong>
          <small>{latest ? `${formatNumber(uniqueCount(latest.followers))} unique IDs` : "Chưa có snapshot"}</small>
        </article>
        <article className="metric panel">
          <span>Following</span>
          <strong>{latest ? formatNumber(latest.counts.following) : "—"}</strong>
          <small>{latest ? `${formatNumber(uniqueCount(latest.following))} unique IDs` : "Chưa có snapshot"}</small>
        </article>
        <article className="metric panel">
          <span>Last crawl duration</span>
          <strong>{latest ? formatDuration(latest.durationMs) : "—"}</strong>
          <small>{latest ? formatDate(latest.crawledAt) : "Chưa chạy"}</small>
        </article>
      </section>

      <section className="two-col">
        <article className="panel progress-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">REALTIME</span>
              <h2>Crawl progress</h2>
            </div>
            <span className={`run-state ${busy ? "running" : "idle"}`}>{busy ? "RUNNING" : "IDLE"}</span>
          </div>

          <div className="progress-main">
            <strong>{progress ? `${progress.kind === "followers" ? "Followers" : "Following"} · page ${progress.page}` : "No run"}</strong>
            <span>{progress ? `${formatNumber(progress.loaded)} accounts received` : "Run live crawl để bắt đầu telemetry"}</span>
          </div>
          <div className="progress-meta">
            <span>Elapsed <b>{formatDuration(progress?.elapsedMs)}</b></span>
            <span>Page latency <b>{formatDuration(progress?.pageLatencyMs)}</b></span>
            <span>Next page <b>{progress?.hasNextPage == null ? "—" : progress.hasNextPage ? "yes" : "no"}</b></span>
          </div>

          <div className="log-box">
            {logs.length ? logs.slice().reverse().map((item, index) => (
              <div className="log-line" key={`${item.kind}-${item.page}-${item.at || index}-${index}`}>
                <code>{item.at ? new Date(item.at).toLocaleTimeString("vi-VN") : "now"}</code>
                <span>{item.kind}</span>
                <span>page {item.page}</span>
                <span>{formatNumber(item.loaded)} users</span>
                <span>{item.pageLatencyMs != null ? `${item.pageLatencyMs} ms` : ""}</span>
              </div>
            )) : <div className="empty-log">Chưa có telemetry.</div>}
          </div>
        </article>

        <article className="panel validation-panel">
          <div className="panel-head">
            <div>
              <span className="section-kicker">VALIDATION</span>
              <h2>Snapshot integrity</h2>
            </div>
            <span className={`score ${validations.length && passCount === validations.length ? "pass" : "neutral"}`}>
              {validations.length ? `${passCount}/${validations.length}` : "—"}
            </span>
          </div>
          <div className="checks">
            {validations.length ? validations.map((item) => (
              <div className="check" key={item.label}>
                <span className={item.ok ? "check-icon ok" : "check-icon fail"}>{item.ok ? "✓" : "×"}</span>
                <div><b>{item.label}</b><small>{item.detail}</small></div>
              </div>
            )) : <div className="placeholder">Chưa có snapshot để validate.</div>}
          </div>
        </article>
      </section>

      <section className="diff-grid">
        <article className="metric panel danger">
          <span>Mất follower vs baseline</span>
          <strong>{diff ? formatNumber(diff.lostFollowers.length) : "—"}</strong>
          <small>baseline → latest</small>
        </article>
        <article className="metric panel warning">
          <span>Bạn đã unfollow</span>
          <strong>{diff ? formatNumber(diff.unfollowed.length) : "—"}</strong>
          <small>baseline → latest</small>
        </article>
        <article className="metric panel success">
          <span>Follower mới</span>
          <strong>{diff ? formatNumber(diff.newFollowers.length) : "—"}</strong>
          <small>baseline → latest</small>
        </article>
        <article className="metric panel info">
          <span>Following mới</span>
          <strong>{diff ? formatNumber(diff.newFollowing.length) : "—"}</strong>
          <small>baseline → latest</small>
        </article>
      </section>

      <section className="two-col sample-section">
        <article className="panel sample-panel">
          <div className="panel-head"><h2>Raw follower sample</h2><span>{sampleFollowers.length}/12</span></div>
          <div className="user-table">
            {sampleFollowers.length ? sampleFollowers.map((user) => (
              <div className="user-row" key={userKey(user)}>
                <b>@{user.username}</b><span>{user.fullName || "—"}</span><code>{user.id}</code>
              </div>
            )) : <div className="placeholder">Chưa có data.</div>}
          </div>
        </article>

        <article className="panel sample-panel">
          <div className="panel-head"><h2>Raw following sample</h2><span>{sampleFollowing.length}/12</span></div>
          <div className="user-table">
            {sampleFollowing.length ? sampleFollowing.map((user) => (
              <div className="user-row" key={userKey(user)}>
                <b>@{user.username}</b><span>{user.fullName || "—"}</span><code>{user.id}</code>
              </div>
            )) : <div className="placeholder">Chưa có data.</div>}
          </div>
        </article>
      </section>

      <section className="panel history-panel">
        <div className="panel-head">
          <div><span className="section-kicker">HISTORY</span><h2>Snapshots hiện có</h2></div>
          <span>{account?.snapshotCount || 0} snapshots</span>
        </div>
        <div className="history-table">
          <div className="history-row history-head"><span>Time</span><span>Followers</span><span>Following</span><span>Duration</span><span>ID</span></div>
          {account?.history?.length ? [...account.history].reverse().map((snapshot) => (
            <div className="history-row" key={snapshot.id}>
              <span>{formatDate(snapshot.crawledAt)}</span>
              <span>{formatNumber(snapshot.counts.followers)}</span>
              <span>{formatNumber(snapshot.counts.following)}</span>
              <span>{formatDuration(snapshot.durationMs)}</span>
              <code>{snapshot.id.slice(0, 12)}</code>
            </div>
          )) : <div className="placeholder">Chưa có snapshot history.</div>}
        </div>
      </section>

      <footer>
        Website chỉ là control/validation surface. Cookie Instagram và follower/following data không được gửi tới Next.js server hay Vercel API.
      </footer>
    </main>
  );
}
