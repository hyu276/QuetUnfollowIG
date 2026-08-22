alter table public.ig_crawl_runs
  add column if not exists captured_at timestamptz;

update public.ig_crawl_runs
set captured_at = created_at
where captured_at is null;

create index if not exists ig_crawl_runs_target_captured_idx
  on public.ig_crawl_runs (workspace_id, target_ig_id, captured_at desc)
  where is_complete = true;

create or replace function public.ig_compute_run_changes(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.ig_crawl_runs%rowtype;
  v_previous uuid;
  v_lost integer := 0;
  v_new integer := 0;
  v_unfollowed integer := 0;
  v_followed integer := 0;
begin
  select * into v_run from public.ig_crawl_runs where id = p_run_id;
  if not found then raise exception 'crawl run not found'; end if;
  if not v_run.is_complete then raise exception 'crawl run is not complete'; end if;

  select r.id into v_previous
  from public.ig_crawl_runs r
  where r.workspace_id = v_run.workspace_id
    and r.target_ig_id = v_run.target_ig_id
    and r.is_complete = true
    and r.id <> v_run.id
    and (
      coalesce(r.captured_at, r.created_at) < coalesce(v_run.captured_at, v_run.created_at)
      or (
        coalesce(r.captured_at, r.created_at) = coalesce(v_run.captured_at, v_run.created_at)
        and r.created_at < v_run.created_at
      )
    )
  order by coalesce(r.captured_at, r.created_at) desc, r.created_at desc
  limit 1;

  update public.ig_crawl_runs set previous_run_id = v_previous where id = p_run_id;
  delete from public.ig_crawl_changes where run_id = p_run_id;

  if v_previous is null then
    return jsonb_build_object('previousRunId', null, 'lostFollowers', 0, 'newFollowers', 0, 'targetUnfollowed', 0, 'targetFollowed', 0);
  end if;

  insert into public.ig_crawl_changes (run_id, previous_run_id, change_type, profile_ig_id)
  select p_run_id, v_previous, 'lost_follower', old.profile_ig_id
  from public.ig_crawl_memberships old
  where old.run_id = v_previous and old.relation = 'followers'
    and not exists (
      select 1 from public.ig_crawl_memberships cur
      where cur.run_id = p_run_id and cur.relation = 'followers' and cur.profile_ig_id = old.profile_ig_id
    );
  get diagnostics v_lost = row_count;

  insert into public.ig_crawl_changes (run_id, previous_run_id, change_type, profile_ig_id)
  select p_run_id, v_previous, 'new_follower', cur.profile_ig_id
  from public.ig_crawl_memberships cur
  where cur.run_id = p_run_id and cur.relation = 'followers'
    and not exists (
      select 1 from public.ig_crawl_memberships old
      where old.run_id = v_previous and old.relation = 'followers' and old.profile_ig_id = cur.profile_ig_id
    );
  get diagnostics v_new = row_count;

  insert into public.ig_crawl_changes (run_id, previous_run_id, change_type, profile_ig_id)
  select p_run_id, v_previous, 'target_unfollowed', old.profile_ig_id
  from public.ig_crawl_memberships old
  where old.run_id = v_previous and old.relation = 'following'
    and not exists (
      select 1 from public.ig_crawl_memberships cur
      where cur.run_id = p_run_id and cur.relation = 'following' and cur.profile_ig_id = old.profile_ig_id
    );
  get diagnostics v_unfollowed = row_count;

  insert into public.ig_crawl_changes (run_id, previous_run_id, change_type, profile_ig_id)
  select p_run_id, v_previous, 'target_followed', cur.profile_ig_id
  from public.ig_crawl_memberships cur
  where cur.run_id = p_run_id and cur.relation = 'following'
    and not exists (
      select 1 from public.ig_crawl_memberships old
      where old.run_id = v_previous and old.relation = 'following' and old.profile_ig_id = cur.profile_ig_id
    );
  get diagnostics v_followed = row_count;

  return jsonb_build_object(
    'previousRunId', v_previous,
    'lostFollowers', v_lost,
    'newFollowers', v_new,
    'targetUnfollowed', v_unfollowed,
    'targetFollowed', v_followed
  );
end;
$$;

revoke execute on function public.ig_compute_run_changes(uuid) from public, anon, authenticated;
grant execute on function public.ig_compute_run_changes(uuid) to service_role;
