-- TEST-only Owner Alerts support.
-- Adds/reconciles the notification storage already used by push.server.ts.
-- No production database is touched by this repository migration.
begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'personal',
  title text not null,
  body text not null,
  order_id uuid null,
  order_code text null,
  status text null,
  dedupe_key text null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists kind text not null default 'personal',
  add column if not exists order_id uuid null,
  add column if not exists order_code text null,
  add column if not exists status text null,
  add column if not exists dedupe_key text null,
  add column if not exists is_read boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists notifications_dedupe_key_unique
  on public.notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_order_status_idx
  on public.notifications (order_id, status) where order_id is not null;

alter table public.notifications enable row level security;
drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.notifications from anon;
grant select, update on public.notifications to authenticated;
grant all on public.notifications to service_role;

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  p256dh text null,
  auth text null,
  platform text not null default 'web',
  is_active boolean not null default true,
  failure_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.push_tokens
  add column if not exists p256dh text null,
  add column if not exists auth text null,
  add column if not exists platform text not null default 'web',
  add column if not exists is_active boolean not null default true,
  add column if not exists failure_count integer not null default 0,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now();
create index if not exists push_tokens_user_active_idx
  on public.push_tokens (user_id, is_active);
alter table public.push_tokens enable row level security;
drop policy if exists "Users read own push tokens" on public.push_tokens;
create policy "Users read own push tokens"
  on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users insert own push tokens" on public.push_tokens;
create policy "Users insert own push tokens"
  on public.push_tokens for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users update own push tokens" on public.push_tokens;
create policy "Users update own push tokens"
  on public.push_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on public.push_tokens from anon;
grant select, insert, update on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

create table if not exists public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid null references public.notifications(id) on delete set null,
  push_token_id uuid null references public.push_tokens(id) on delete set null,
  status text not null check (status in ('sent', 'failed')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  last_error text null,
  created_at timestamptz not null default now()
);
create index if not exists notification_push_deliveries_notification_idx
  on public.notification_push_deliveries (notification_id, created_at desc);
alter table public.notification_push_deliveries enable row level security;
revoke all on public.notification_push_deliveries from anon, authenticated;
grant all on public.notification_push_deliveries to service_role;

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('review_reminder', 'staff_new_order', 'owner_escalation')),
  order_id uuid null,
  user_id uuid null references auth.users(id) on delete cascade,
  run_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text null,
  created_at timestamptz not null default now()
);
alter table public.notification_jobs
  add column if not exists run_at timestamptz not null default now(),
  add column if not exists status text not null default 'pending',
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error text null,
  add column if not exists created_at timestamptz not null default now();
create index if not exists notification_jobs_due_idx
  on public.notification_jobs (run_at, created_at) where status = 'pending';
alter table public.notification_jobs enable row level security;
revoke all on public.notification_jobs from anon, authenticated;
grant all on public.notification_jobs to service_role;

create or replace function public.claim_notification_jobs(_limit integer default 25)
returns table(id uuid, kind text, order_id uuid, user_id uuid)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select j.id
    from public.notification_jobs as j
    where j.status = 'pending'
      and j.run_at <= now()
    order by j.run_at, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(_limit, 25), 100))
  ),
  claimed as (
    update public.notification_jobs as j
      set status = 'processing', attempts = j.attempts + 1
    from picked
    where j.id = picked.id
    returning j.id, j.kind, j.order_id, j.user_id
  )
  select claimed.id, claimed.kind, claimed.order_id, claimed.user_id
  from claimed;
$$;
revoke all on function public.claim_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_jobs(integer) to service_role;

commit;
