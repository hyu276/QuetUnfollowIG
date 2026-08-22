create index if not exists ig_crawl_runs_previous_run_idx
  on public.ig_crawl_runs (previous_run_id)
  where previous_run_id is not null;

create index if not exists ig_crawl_changes_previous_run_idx
  on public.ig_crawl_changes (previous_run_id)
  where previous_run_id is not null;

create index if not exists ig_crawl_changes_profile_idx
  on public.ig_crawl_changes (profile_ig_id);
