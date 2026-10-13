-- Flamio — Challenge Result Reward rules (optional, additive)
-- Run this once in External Supabase → SQL Editor.
-- It only ADDS two tables. It does not change existing rewards, challenges,
-- reward_rules, reward_transactions, reward_claims, challenge_winners or any policy.

-- 1. Owner-configured rules -------------------------------------------------
create table if not exists public.challenge_result_reward_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  challenge_id uuid references public.challenges(id) on delete cascade,
  result_condition text not null check (result_condition in ('lost', 'close')),
  close_threshold_percent integer not null default 90
    check (close_threshold_percent between 1 and 100),
  points integer not null default 0 check (points >= 0),
  is_enabled boolean not null default false,
  first_time_only boolean not null default false,
  max_per_customer integer not null default 0 check (max_per_customer >= 0),
  max_per_day integer not null default 0 check (max_per_day >= 0),
  max_per_challenge integer not null default 0 check (max_per_challenge >= 0),
  allow_repeat_after_limit boolean not null default false,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists challenge_result_reward_rules_challenge_idx
  on public.challenge_result_reward_rules (challenge_id);

grant select on public.challenge_result_reward_rules to authenticated;
grant all on public.challenge_result_reward_rules to service_role;

alter table public.challenge_result_reward_rules enable row level security;

drop policy if exists "Authenticated users can view challenge reward rules"
  on public.challenge_result_reward_rules;
create policy "Authenticated users can view challenge reward rules"
  on public.challenge_result_reward_rules
  for select to authenticated using (true);

drop trigger if exists update_challenge_result_reward_rules_updated_at
  on public.challenge_result_reward_rules;
create trigger update_challenge_result_reward_rules_updated_at
  before update on public.challenge_result_reward_rules
  for each row execute function public.update_updated_at_column();

-- 2. One row per qualifying challenge result (awarded or blocked) -----------
create table if not exists public.challenge_result_reward_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.challenge_result_reward_rules(id) on delete cascade,
  challenge_id uuid references public.challenges(id) on delete set null,
  -- real challenge play session (existing challenge_sessions table)
  session_id uuid not null references public.challenge_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  result_condition text not null,
  points integer not null default 0 check (points >= 0),
  status text not null check (status in ('awarded', 'blocked')),
  blocked_reason text,
  created_at timestamptz not null default now(),
  -- anti-duplicate: one result can never award the same rule twice
  constraint challenge_result_reward_events_unique unique (rule_id, session_id)
);

create index if not exists challenge_result_reward_events_user_idx
  on public.challenge_result_reward_events (user_id, created_at desc);
create index if not exists challenge_result_reward_events_challenge_idx
  on public.challenge_result_reward_events (challenge_id, created_at desc);

grant select on public.challenge_result_reward_events to authenticated;
grant all on public.challenge_result_reward_events to service_role;

alter table public.challenge_result_reward_events enable row level security;

drop policy if exists "Customers can view their challenge reward events"
  on public.challenge_result_reward_events;
create policy "Customers can view their challenge reward events"
  on public.challenge_result_reward_events
  for select to authenticated using (auth.uid() = user_id);
