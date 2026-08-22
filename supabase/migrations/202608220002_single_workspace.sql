alter table public.ig_workspaces
  add column if not exists singleton boolean not null default true;

alter table public.ig_workspaces
  drop constraint if exists ig_workspaces_singleton_true;

alter table public.ig_workspaces
  add constraint ig_workspaces_singleton_true check (singleton = true);

create unique index if not exists ig_workspaces_singleton_unique
  on public.ig_workspaces (singleton);
