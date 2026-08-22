create table if not exists public.ig_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.ig_profiles (
  instagram_user_id text primary key,
  username text not null,
  full_name text,
  is_private boolean not null default false,
  is_verified boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists ig_profiles_username_lower_idx on public.ig_profiles (lower(username));

create table if not exists public.ig_crawl_targets (
  workspace_id uuid not null references public.ig_workspaces(id) on delete cascade,
  target_ig_id text not null,
  username text not null,
  full_name text,
  is_private boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (workspace_id, target_ig_id)
);

create table if not exists public.ig_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ig_workspaces(id) on delete cascade,
  target_ig_id text not null,
  viewer_ig_id text,
  source_snapshot_id text,
  target_username text not null,
  viewer_username text,
  resolver text,
  target_is_private boolean not null default false,
  viewer_follows_target boolean,
  target_follows_viewer boolean,
  expected_followers integer,
  expected_following integer,
  crawled_followers integer not null default 0,
  crawled_following integer not null default 0,
  uploaded_followers integer not null default 0,
  uploaded_following integer not null default 0,
  duration_ms integer,
  status text not null default 'uploading' check (status in ('uploading','complete','failed')),
  is_complete boolean not null default false,
  previous_run_id uuid references public.ig_crawl_runs(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  client_instance_id text,
  source_version text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint ig_crawl_runs_target_fk foreign key (workspace_id, target_ig_id)
    references public.ig_crawl_targets(workspace_id, target_ig_id) on delete cascade,
  constraint ig_crawl_runs_snapshot_unique unique (workspace_id, source_snapshot_id)
);
create index if not exists ig_crawl_runs_target_finished_idx
  on public.ig_crawl_runs (workspace_id, target_ig_id, finished_at desc)
  where is_complete = true;

create table if not exists public.ig_crawl_memberships (
  run_id uuid not null references public.ig_crawl_runs(id) on delete cascade,
  relation text not null check (relation in ('followers','following')),
  profile_ig_id text not null references public.ig_profiles(instagram_user_id) on delete restrict,
  primary key (run_id, relation, profile_ig_id)
);
create index if not exists ig_crawl_memberships_profile_idx
  on public.ig_crawl_memberships (profile_ig_id, relation, run_id);

create table if not exists public.ig_crawl_changes (
  run_id uuid not null references public.ig_crawl_runs(id) on delete cascade,
  previous_run_id uuid references public.ig_crawl_runs(id) on delete set null,
  change_type text not null check (change_type in ('lost_follower','new_follower','target_unfollowed','target_followed')),
  profile_ig_id text not null references public.ig_profiles(instagram_user_id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (run_id, change_type, profile_ig_id)
);
create index if not exists ig_crawl_changes_run_type_idx
  on public.ig_crawl_changes (run_id, change_type);

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
    and coalesce(r.finished_at, r.created_at) < coalesce(v_run.finished_at, v_run.created_at)
  order by coalesce(r.finished_at, r.created_at) desc
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

alter table public.ig_workspaces enable row level security;
alter table public.ig_profiles enable row level security;
alter table public.ig_crawl_targets enable row level security;
alter table public.ig_crawl_runs enable row level security;
alter table public.ig_crawl_memberships enable row level security;
alter table public.ig_crawl_changes enable row level security;

revoke all on public.ig_workspaces from anon, authenticated;
revoke all on public.ig_profiles from anon, authenticated;
revoke all on public.ig_crawl_targets from anon, authenticated;
revoke all on public.ig_crawl_runs from anon, authenticated;
revoke all on public.ig_crawl_memberships from anon, authenticated;
revoke all on public.ig_crawl_changes from anon, authenticated;
revoke execute on function public.ig_compute_run_changes(uuid) from public, anon, authenticated;
grant execute on function public.ig_compute_run_changes(uuid) to service_role;
