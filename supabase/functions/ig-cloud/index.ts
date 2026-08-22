import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-workspace-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanToken(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

async function getWorkspace(req: Request, body: any) {
  const token = cleanToken(req.headers.get("x-workspace-key") || body?.workspaceKey);
  if (token.length < 24) throw new Error("Cloud Workspace Key không hợp lệ.");
  const tokenHash = await sha256(token);
  const { data, error } = await supabase.from("ig_workspaces").select("id,name,created_at,last_used_at").eq("token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Cloud Workspace Key không tồn tại.");
  await supabase.from("ig_workspaces").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

async function assertRunWorkspace(runId: string, workspaceId: string) {
  const { data, error } = await supabase.from("ig_crawl_runs")
    .select("id,workspace_id,target_ig_id,status,is_complete,crawled_followers,crawled_following,viewer_ig_id,previous_run_id")
    .eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Crawl run không tồn tại trong workspace này.");
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
  const { data, error } = await supabase.from("ig_profiles")
    .select("instagram_user_id,username,full_name,is_private,is_verified")
    .in("instagram_user_id", unique);
  if (error) throw error;
  const map = new Map((data || []).map((p: any) => [p.instagram_user_id, p]));
  return unique.map((id) => map.get(id) || { instagram_user_id: id });
}

async function getChanges(runId: string) {
  const { data: changes, error } = await supabase.from("ig_crawl_changes")
    .select("change_type,profile_ig_id,previous_run_id").eq("run_id", runId);
  if (error) throw error;
  const profiles = await hydrateProfiles((changes || []).map((x: any) => x.profile_ig_id));
  const profileMap = new Map(profiles.map((p: any) => [p.instagram_user_id, p]));
  const grouped: Record<string, any[]> = { lost_follower: [], new_follower: [], target_unfollowed: [], target_followed: [] };
  for (const change of changes || []) grouped[change.change_type]?.push(profileMap.get(change.profile_ig_id) || { instagram_user_id: change.profile_ig_id });
  return grouped;
}

async function getSamples(runId: string, relation: "followers" | "following", limit = 12) {
  const { data, error } = await supabase.from("ig_crawl_memberships")
    .select("profile_ig_id").eq("run_id", runId).eq("relation", relation).limit(limit);
  if (error) throw error;
  return hydrateProfiles((data || []).map((x: any) => x.profile_ig_id));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "create_workspace") {
      const token = cleanToken(body?.workspaceKey);
      if (token.length < 32) return json({ ok: false, error: "Workspace key phải có ít nhất 32 ký tự." }, 400);
      const tokenHash = await sha256(token);
      const name = String(body?.name || "QuetUnfollowIG Workspace").slice(0, 100);
      const { data: existing, error: existingError } = await supabase.from("ig_workspaces").select("id,name,created_at").eq("token_hash", tokenHash).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return json({ ok: true, workspace: existing, created: false });
      const { data, error } = await supabase.from("ig_workspaces")
        .insert({ name, token_hash: tokenHash, last_used_at: new Date().toISOString() })
        .select("id,name,created_at").single();
      if (error) throw error;
      return json({ ok: true, workspace: data, created: true });
    }

    const workspace = await getWorkspace(req, body);
    if (action === "ping") return json({ ok: true, workspace });

    if (action === "list_targets") {
      const { data, error } = await supabase.from("ig_crawl_targets")
        .select("target_ig_id,username,full_name,is_private,first_seen_at,last_seen_at")
        .eq("workspace_id", workspace.id).order("last_seen_at", { ascending: false });
      if (error) throw error;
      return json({ ok: true, workspace, targets: data || [] });
    }

    if (action === "start_run") {
      const target = body?.target || {};
      const viewer = body?.viewer || {};
      const targetId = String(target.id || target.instagramUserId || "");
      if (!targetId) return json({ ok: false, error: "Thiếu target Instagram ID." }, 400);
      const targetUsername = String(target.username || targetId);

      const { error: targetError } = await supabase.from("ig_crawl_targets").upsert({
        workspace_id: workspace.id, target_ig_id: targetId, username: targetUsername,
        full_name: target.fullName || "", is_private: Boolean(target.isPrivate), last_seen_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,target_ig_id" });
      if (targetError) throw targetError;

      const sourceSnapshotId = body?.snapshotId ? String(body.snapshotId) : null;
      if (sourceSnapshotId) {
        const { data: existing } = await supabase.from("ig_crawl_runs").select("id,status,is_complete")
          .eq("workspace_id", workspace.id).eq("source_snapshot_id", sourceSnapshotId).maybeSingle();
        if (existing) return json({ ok: true, run: existing, reused: true });
      }

      const { data, error } = await supabase.from("ig_crawl_runs").insert({
        workspace_id: workspace.id, target_ig_id: targetId, viewer_ig_id: viewer.id ? String(viewer.id) : null,
        source_snapshot_id: sourceSnapshotId, target_username: targetUsername, viewer_username: viewer.username || null,
        resolver: target.resolver || null, target_is_private: Boolean(target.isPrivate),
        viewer_follows_target: target.viewerFollowsTarget ?? null, target_follows_viewer: target.targetFollowsViewer ?? null,
        expected_followers: Number.isFinite(target.expectedFollowers) ? target.expectedFollowers : null,
        expected_following: Number.isFinite(target.expectedFollowing) ? target.expectedFollowing : null,
        crawled_followers: Number(body?.counts?.followers || 0), crawled_following: Number(body?.counts?.following || 0),
        duration_ms: Number(body?.durationMs || 0) || null, started_at: body?.startedAt || null,
        client_instance_id: body?.clientInstanceId || null, source_version: body?.sourceVersion || null,
      }).select("id,status,is_complete,target_ig_id,created_at").single();
      if (error) throw error;
      return json({ ok: true, run: data, reused: false });
    }

    if (action === "upload_chunk") {
      const runId = String(body?.runId || "");
      const relation = body?.relation === "following" ? "following" : body?.relation === "followers" ? "followers" : "";
      if (!runId || !relation) return json({ ok: false, error: "Thiếu runId hoặc relation." }, 400);
      const run = await assertRunWorkspace(runId, workspace.id);
      if (run.is_complete) return json({ ok: true, uploaded: 0, alreadyComplete: true });
      const profiles = (Array.isArray(body?.users) ? body.users : []).map(normalizeProfile).filter((p: any) => p.instagram_user_id && p.username);
      if (!profiles.length) return json({ ok: true, uploaded: 0 });
      const { error: profileError } = await supabase.from("ig_profiles").upsert(profiles, { onConflict: "instagram_user_id" });
      if (profileError) throw profileError;
      const memberships = profiles.map((p: any) => ({ run_id: runId, relation, profile_ig_id: p.instagram_user_id }));
      const { error: memberError } = await supabase.from("ig_crawl_memberships")
        .upsert(memberships, { onConflict: "run_id,relation,profile_ig_id", ignoreDuplicates: true });
      if (memberError) throw memberError;
      return json({ ok: true, uploaded: memberships.length });
    }

    if (action === "finalize_run") {
      const runId = String(body?.runId || "");
      if (!runId) return json({ ok: false, error: "Thiếu runId." }, 400);
      const run = await assertRunWorkspace(runId, workspace.id);
      if (run.is_complete) return json({ ok: true, run, changes: await getChanges(runId), alreadyComplete: true });

      const followersCountResult = await supabase.from("ig_crawl_memberships").select("profile_ig_id", { count: "exact", head: true }).eq("run_id", runId).eq("relation", "followers");
      if (followersCountResult.error) throw followersCountResult.error;
      const followingCountResult = await supabase.from("ig_crawl_memberships").select("profile_ig_id", { count: "exact", head: true }).eq("run_id", runId).eq("relation", "following");
      if (followingCountResult.error) throw followingCountResult.error;
      const uploadedFollowers = followersCountResult.count || 0;
      const uploadedFollowing = followingCountResult.count || 0;

      if (uploadedFollowers !== run.crawled_followers || uploadedFollowing !== run.crawled_following) {
        const errorMessage = `Cloud upload incomplete: followers ${uploadedFollowers}/${run.crawled_followers}, following ${uploadedFollowing}/${run.crawled_following}`;
        await supabase.from("ig_crawl_runs").update({ status: "failed", is_complete: false,
          uploaded_followers: uploadedFollowers, uploaded_following: uploadedFollowing,
          error_message: errorMessage, finished_at: new Date().toISOString() }).eq("id", runId);
        return json({ ok: false, error: errorMessage, uploadedFollowers, uploadedFollowing }, 409);
      }

      const { data: completed, error: completeError } = await supabase.from("ig_crawl_runs").update({
        status: "complete", is_complete: true, uploaded_followers: uploadedFollowers,
        uploaded_following: uploadedFollowing, finished_at: new Date().toISOString(), error_message: null,
      }).eq("id", runId).select("*").single();
      if (completeError) throw completeError;
      const { data: summary, error: diffError } = await supabase.rpc("ig_compute_run_changes", { p_run_id: runId });
      if (diffError) throw diffError;
      return json({ ok: true, run: completed, diffSummary: summary, changes: await getChanges(runId) });
    }

    if (action === "target_status") {
      const targetId = String(body?.targetIgId || "");
      if (!targetId) return json({ ok: false, error: "Thiếu targetIgId." }, 400);
      const { data: target, error: targetError } = await supabase.from("ig_crawl_targets")
        .select("target_ig_id,username,full_name,is_private,first_seen_at,last_seen_at")
        .eq("workspace_id", workspace.id).eq("target_ig_id", targetId).maybeSingle();
      if (targetError) throw targetError;
      const { data: history, error: historyError } = await supabase.from("ig_crawl_runs")
        .select("id,target_username,viewer_ig_id,viewer_username,crawled_followers,crawled_following,duration_ms,previous_run_id,finished_at,created_at")
        .eq("workspace_id", workspace.id).eq("target_ig_id", targetId).eq("is_complete", true)
        .order("finished_at", { ascending: false }).limit(30);
      if (historyError) throw historyError;
      const latest = history?.[0] || null;
      let previous = null;
      if (latest?.previous_run_id) {
        const result = await supabase.from("ig_crawl_runs")
          .select("id,viewer_ig_id,viewer_username,finished_at,crawled_followers,crawled_following")
          .eq("id", latest.previous_run_id).maybeSingle();
        if (result.error) throw result.error;
        previous = result.data;
      }
      const changes = latest ? await getChanges(latest.id) : { lost_follower: [], new_follower: [], target_unfollowed: [], target_followed: [] };
      const samples = latest ? {
        followers: await getSamples(latest.id, "followers", 12),
        following: await getSamples(latest.id, "following", 12),
      } : { followers: [], following: [] };
      return json({
        ok: true, workspace, target, history: history || [], latest, previous, changes, samples,
        comparison: latest ? {
          previousRunId: latest.previous_run_id || null,
          viewerChanged: Boolean(previous && previous.viewer_ig_id !== latest.viewer_ig_id),
          currentViewerId: latest.viewer_ig_id || null,
          previousViewerId: previous?.viewer_ig_id || null,
        } : null
      });
    }

    return json({ ok: false, error: "Action không được hỗ trợ." }, 400);
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
