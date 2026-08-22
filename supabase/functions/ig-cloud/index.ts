import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const MAX_CHUNK_USERS = 500;
const PROFILE_HYDRATE_BATCH = 200;
const STALE_RUN_HOURS = 6;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-workspace-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanToken(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function captureTime(value: unknown) {
  if (typeof value !== "string" || !value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mismatchTooLarge(actual: number, expected: number | null) {
  if (expected == null) return false;
  const tolerance = Math.max(3, Math.ceil(expected * 0.005));
  return Math.abs(actual - expected) > tolerance;
}

async function touchWorkspace(workspaceId: string) {
  await supabase.from("ig_workspaces")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", workspaceId);
}

async function getWorkspace(req: Request, body: any) {
  const token = cleanToken(req.headers.get("x-workspace-key") || body?.workspaceKey);
  if (token.length < 24) throw new ApiError("Cloud Workspace Key không hợp lệ.", 401, "INVALID_WORKSPACE_KEY");
  const tokenHash = await sha256(token);
  const { data, error } = await supabase.from("ig_workspaces")
    .select("id,name,created_at,last_used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("Cloud Workspace Key không tồn tại.", 401, "WORKSPACE_NOT_FOUND");
  return data;
}

async function assertRunWorkspace(runId: string, workspaceId: string) {
  const { data, error } = await supabase.from("ig_crawl_runs")
    .select("id,workspace_id,target_ig_id,status,is_complete,crawled_followers,crawled_following,expected_followers,expected_following,viewer_ig_id,previous_run_id,captured_at,created_at")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("Crawl run không tồn tại trong workspace này.", 404, "RUN_NOT_FOUND");
  return data;
}

function normalizeProfile(raw: any) {
  return {
    instagram_user_id: String(raw?.id ?? raw?.pk ?? raw?.instagram_user_id ?? ""),
    username: String(raw?.username ?? ""),
    full_name: String(raw?.fullName ?? raw?.full_name ?? ""),
    is_private: Boolean(raw?.isPrivate ?? raw?.is_private),
    is_verified: Boolean(raw?.isVerified ?? raw?.is_verified),
    updated_at: new Date().toISOString(),
  };
}

async function hydrateProfiles(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];

  const rows: any[] = [];
  for (let index = 0; index < unique.length; index += PROFILE_HYDRATE_BATCH) {
    const chunk = unique.slice(index, index + PROFILE_HYDRATE_BATCH);
    const { data, error } = await supabase.from("ig_profiles")
      .select("instagram_user_id,username,full_name,is_private,is_verified")
      .in("instagram_user_id", chunk);
    if (error) throw error;
    rows.push(...(data || []));
  }

  const map = new Map(rows.map((p: any) => [p.instagram_user_id, p]));
  return unique.map((id) => map.get(id) || { instagram_user_id: id });
}

async function getChanges(runId: string) {
  const { data: changes, error } = await supabase.from("ig_crawl_changes")
    .select("change_type,profile_ig_id,previous_run_id")
    .eq("run_id", runId);
  if (error) throw error;
  const profiles = await hydrateProfiles((changes || []).map((x: any) => x.profile_ig_id));
  const profileMap = new Map(profiles.map((p: any) => [p.instagram_user_id, p]));
  const grouped: Record<string, any[]> = {
    lost_follower: [],
    new_follower: [],
    target_unfollowed: [],
    target_followed: []
  };
  for (const change of changes || []) {
    grouped[change.change_type]?.push(
      profileMap.get(change.profile_ig_id) || { instagram_user_id: change.profile_ig_id }
    );
  }
  for (const list of Object.values(grouped)) {
    list.sort((a: any, b: any) => String(a.username || "").localeCompare(String(b.username || "")));
  }
  return grouped;
}

async function getSamples(runId: string, relation: "followers" | "following", limit = 12) {
  const { data, error } = await supabase.from("ig_crawl_memberships")
    .select("profile_ig_id")
    .eq("run_id", runId)
    .eq("relation", relation)
    .limit(limit);
  if (error) throw error;
  return hydrateProfiles((data || []).map((x: any) => x.profile_ig_id));
}

async function markRunFailed(runId: string, message: string, uploadedFollowers = 0, uploadedFollowing = 0) {
  await supabase.from("ig_crawl_runs").update({
    status: "failed",
    is_complete: false,
    uploaded_followers: uploadedFollowers,
    uploaded_following: uploadedFollowing,
    error_message: message,
    finished_at: new Date().toISOString()
  }).eq("id", runId);
}

async function recomputeImmediateSuccessor(run: any) {
  const currentCaptured = run.captured_at || run.created_at;
  const { data: successor, error } = await supabase.from("ig_crawl_runs")
    .select("id")
    .eq("workspace_id", run.workspace_id)
    .eq("target_ig_id", run.target_ig_id)
    .eq("is_complete", true)
    .gt("captured_at", currentCaptured)
    .order("captured_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!successor) return;
  const { error: diffError } = await supabase.rpc("ig_compute_run_changes", { p_run_id: successor.id });
  if (diffError) throw diffError;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required", code: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "create_workspace") {
      const token = cleanToken(body?.workspaceKey);
      if (token.length < 32) throw new ApiError("Workspace key phải có ít nhất 32 ký tự.", 400, "INVALID_WORKSPACE_KEY");
      const tokenHash = await sha256(token);
      const name = String(body?.name || "QuetUnfollowIG Workspace").slice(0, 100);

      const { data: existing, error: existingError } = await supabase.from("ig_workspaces")
        .select("id,name,created_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ ok: true, workspace: existing, created: false });

      const { data: anyWorkspace, error: anyWorkspaceError } = await supabase.from("ig_workspaces")
        .select("id")
        .limit(1)
        .maybeSingle();
      if (anyWorkspaceError) throw anyWorkspaceError;
      if (anyWorkspace) {
        throw new ApiError(
          "Cloud Workspace đã tồn tại. Trên thiết bị mới, hãy nhập Cloud Workspace Key từ thiết bị đã thiết lập trước đó.",
          409,
          "WORKSPACE_ALREADY_EXISTS"
        );
      }

      const { data, error } = await supabase.from("ig_workspaces")
        .insert({ name, token_hash: tokenHash, last_used_at: new Date().toISOString() })
        .select("id,name,created_at")
        .single();
      if (error) throw error;
      return json({ ok: true, workspace: data, created: true });
    }

    const workspace = await getWorkspace(req, body);

    if (action === "ping") {
      await touchWorkspace(workspace.id);
      return json({ ok: true, workspace });
    }

    if (action === "list_targets") {
      const { data, error } = await supabase.from("ig_crawl_targets")
        .select("target_ig_id,username,full_name,is_private,first_seen_at,last_seen_at")
        .eq("workspace_id", workspace.id)
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return json({ ok: true, workspace, targets: data || [] });
    }

    if (action === "start_run") {
      const target = body?.target || {};
      const viewer = body?.viewer || {};
      const targetId = String(target.id || target.instagramUserId || "");
      if (!targetId) throw new ApiError("Thiếu target Instagram ID.", 400, "TARGET_ID_REQUIRED");
      const targetUsername = String(target.username || targetId);

      await touchWorkspace(workspace.id);
      const staleCutoff = new Date(Date.now() - STALE_RUN_HOURS * 60 * 60 * 1000).toISOString();
      await supabase.from("ig_crawl_runs").update({
        status: "failed",
        error_message: "Upload session expired before finalize.",
        finished_at: new Date().toISOString()
      })
        .eq("workspace_id", workspace.id)
        .eq("target_ig_id", targetId)
        .eq("status", "uploading")
        .lt("created_at", staleCutoff);

      const { error: targetError } = await supabase.from("ig_crawl_targets").upsert({
        workspace_id: workspace.id,
        target_ig_id: targetId,
        username: targetUsername,
        full_name: target.fullName || "",
        is_private: Boolean(target.isPrivate),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,target_ig_id" });
      if (targetError) throw targetError;

      const sourceSnapshotId = body?.snapshotId ? String(body.snapshotId) : null;
      if (sourceSnapshotId) {
        const { data: existingRun, error: existingRunError } = await supabase.from("ig_crawl_runs")
          .select("id,status,is_complete")
          .eq("workspace_id", workspace.id)
          .eq("source_snapshot_id", sourceSnapshotId)
          .maybeSingle();
        if (existingRunError) throw existingRunError;
        if (existingRun) return json({ ok: true, run: existingRun, reused: true });
      }

      const { data, error } = await supabase.from("ig_crawl_runs").insert({
        workspace_id: workspace.id,
        target_ig_id: targetId,
        viewer_ig_id: viewer.id ? String(viewer.id) : null,
        source_snapshot_id: sourceSnapshotId,
        target_username: targetUsername,
        viewer_username: viewer.username || null,
        resolver: target.resolver || null,
        target_is_private: Boolean(target.isPrivate),
        viewer_follows_target: target.viewerFollowsTarget ?? null,
        target_follows_viewer: target.targetFollowsViewer ?? null,
        expected_followers: finiteNumber(target.expectedFollowers),
        expected_following: finiteNumber(target.expectedFollowing),
        crawled_followers: finiteNumber(body?.counts?.followers) || 0,
        crawled_following: finiteNumber(body?.counts?.following) || 0,
        duration_ms: finiteNumber(body?.durationMs),
        started_at: body?.startedAt || null,
        captured_at: captureTime(body?.capturedAt),
        client_instance_id: body?.clientInstanceId || null,
        source_version: body?.sourceVersion || null,
      }).select("id,status,is_complete,target_ig_id,captured_at,created_at").single();
      if (error) throw error;
      return json({ ok: true, run: data, reused: false });
    }

    if (action === "upload_chunk") {
      const runId = String(body?.runId || "");
      const relation = body?.relation === "following"
        ? "following"
        : body?.relation === "followers"
          ? "followers"
          : "";
      if (!runId || !relation) throw new ApiError("Thiếu runId hoặc relation.", 400, "UPLOAD_INPUT_INVALID");
      const run = await assertRunWorkspace(runId, workspace.id);
      if (run.is_complete) return json({ ok: true, uploaded: 0, alreadyComplete: true });

      const rawUsers = Array.isArray(body?.users) ? body.users : [];
      if (rawUsers.length > MAX_CHUNK_USERS) {
        throw new ApiError(`Mỗi upload chunk tối đa ${MAX_CHUNK_USERS} users.`, 413, "CHUNK_TOO_LARGE");
      }

      const profileMap = new Map<string, any>();
      for (const raw of rawUsers) {
        const profile = normalizeProfile(raw);
        if (profile.instagram_user_id) profileMap.set(profile.instagram_user_id, profile);
      }
      const profiles = [...profileMap.values()];
      if (!profiles.length) return json({ ok: true, uploaded: 0 });

      const { error: profileError } = await supabase.from("ig_profiles")
        .upsert(profiles, { onConflict: "instagram_user_id" });
      if (profileError) throw profileError;

      const memberships = profiles.map((p: any) => ({
        run_id: runId,
        relation,
        profile_ig_id: p.instagram_user_id
      }));
      const { error: memberError } = await supabase.from("ig_crawl_memberships")
        .upsert(memberships, {
          onConflict: "run_id,relation,profile_ig_id",
          ignoreDuplicates: true
        });
      if (memberError) throw memberError;
      return json({ ok: true, uploaded: memberships.length });
    }

    if (action === "finalize_run") {
      const runId = String(body?.runId || "");
      if (!runId) throw new ApiError("Thiếu runId.", 400, "RUN_ID_REQUIRED");
      const run = await assertRunWorkspace(runId, workspace.id);
      if (run.is_complete) {
        return json({ ok: true, run, changes: await getChanges(runId), alreadyComplete: true });
      }

      const followersCountResult = await supabase.from("ig_crawl_memberships")
        .select("profile_ig_id", { count: "exact", head: true })
        .eq("run_id", runId)
        .eq("relation", "followers");
      if (followersCountResult.error) throw followersCountResult.error;

      const followingCountResult = await supabase.from("ig_crawl_memberships")
        .select("profile_ig_id", { count: "exact", head: true })
        .eq("run_id", runId)
        .eq("relation", "following");
      if (followingCountResult.error) throw followingCountResult.error;

      const uploadedFollowers = followersCountResult.count || 0;
      const uploadedFollowing = followingCountResult.count || 0;

      if (uploadedFollowers !== run.crawled_followers || uploadedFollowing !== run.crawled_following) {
        const errorMessage = `Cloud upload incomplete: followers ${uploadedFollowers}/${run.crawled_followers}, following ${uploadedFollowing}/${run.crawled_following}`;
        await markRunFailed(runId, errorMessage, uploadedFollowers, uploadedFollowing);
        return json({ ok: false, error: errorMessage, code: "UPLOAD_INCOMPLETE" }, 409);
      }

      const followerMismatch = mismatchTooLarge(run.crawled_followers, run.expected_followers);
      const followingMismatch = mismatchTooLarge(run.crawled_following, run.expected_following);
      if (followerMismatch || followingMismatch) {
        const parts = [];
        if (followerMismatch) parts.push(`followers ${run.crawled_followers}/${run.expected_followers}`);
        if (followingMismatch) parts.push(`following ${run.crawled_following}/${run.expected_following}`);
        const errorMessage = `Crawl completeness check failed (${parts.join(", ")}). Run này không được dùng để suy luận unfollow.`;
        await markRunFailed(runId, errorMessage, uploadedFollowers, uploadedFollowing);
        return json({ ok: false, error: errorMessage, code: "CRAWL_INCOMPLETE" }, 409);
      }

      const { data: completed, error: completeError } = await supabase.from("ig_crawl_runs").update({
        status: "complete",
        is_complete: true,
        uploaded_followers: uploadedFollowers,
        uploaded_following: uploadedFollowing,
        finished_at: new Date().toISOString(),
        error_message: null,
      }).eq("id", runId).select("*").single();
      if (completeError) throw completeError;

      await touchWorkspace(workspace.id);
      const { data: summary, error: diffError } = await supabase.rpc("ig_compute_run_changes", {
        p_run_id: runId
      });
      if (diffError) throw diffError;

      await recomputeImmediateSuccessor(completed);
      return json({
        ok: true,
        run: completed,
        diffSummary: summary,
        changes: await getChanges(runId)
      });
    }

    if (action === "target_status") {
      const targetId = String(body?.targetIgId || "");
      if (!targetId) throw new ApiError("Thiếu targetIgId.", 400, "TARGET_ID_REQUIRED");
      await touchWorkspace(workspace.id);

      const { data: target, error: targetError } = await supabase.from("ig_crawl_targets")
        .select("target_ig_id,username,full_name,is_private,first_seen_at,last_seen_at")
        .eq("workspace_id", workspace.id)
        .eq("target_ig_id", targetId)
        .maybeSingle();
      if (targetError) throw targetError;

      const { data: history, error: historyError } = await supabase.from("ig_crawl_runs")
        .select("id,target_username,viewer_ig_id,viewer_username,crawled_followers,crawled_following,duration_ms,previous_run_id,captured_at,finished_at,created_at")
        .eq("workspace_id", workspace.id)
        .eq("target_ig_id", targetId)
        .eq("is_complete", true)
        .order("captured_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(30);
      if (historyError) throw historyError;

      const latest = history?.[0] || null;
      let previous = null;
      if (latest?.previous_run_id) {
        const result = await supabase.from("ig_crawl_runs")
          .select("id,viewer_ig_id,viewer_username,captured_at,finished_at,crawled_followers,crawled_following")
          .eq("id", latest.previous_run_id)
          .maybeSingle();
        if (result.error) throw result.error;
        previous = result.data;
      }

      const changes = latest
        ? await getChanges(latest.id)
        : { lost_follower: [], new_follower: [], target_unfollowed: [], target_followed: [] };
      const samples = latest
        ? {
            followers: await getSamples(latest.id, "followers", 12),
            following: await getSamples(latest.id, "following", 12),
          }
        : { followers: [], following: [] };

      return json({
        ok: true,
        workspace,
        target,
        history: history || [],
        latest,
        previous,
        changes,
        samples,
        comparison: latest
          ? {
              previousRunId: latest.previous_run_id || null,
              viewerChanged: Boolean(previous && previous.viewer_ig_id !== latest.viewer_ig_id),
              currentViewerId: latest.viewer_ig_id || null,
              previousViewerId: previous?.viewer_ig_id || null,
            }
          : null
      });
    }

    throw new ApiError("Action không được hỗ trợ.", 400, "ACTION_NOT_SUPPORTED");
  } catch (error) {
    console.error(error);
    if (error instanceof ApiError) {
      return json({ ok: false, error: error.message, code: error.code }, error.status);
    }
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      code: "INTERNAL_ERROR"
    }, 500);
  }
});
