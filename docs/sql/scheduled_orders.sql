-- Scheduled pre-orders + automatic open/closed (additive only).

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS auto_hours_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scheduled_orders_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_max_advance_days integer NOT NULL DEFAULT 3
    CHECK (scheduled_max_advance_days BETWEEN 1 AND 14),
  ADD COLUMN IF NOT EXISTS scheduled_payment_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_prep_minutes integer NOT NULL DEFAULT 30
    CHECK (scheduled_prep_minutes BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS scheduled_slot_minutes integer NOT NULL DEFAULT 30
    CHECK (scheduled_slot_minutes BETWEEN 10 AND 120),
  ADD COLUMN IF NOT EXISTS scheduled_allow_while_closed boolean NOT NULL DEFAULT true;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_kind text NOT NULL DEFAULT 'regular'
    CHECK (order_kind IN ('regular', 'scheduled')),
  ADD COLUMN IF NOT EXISTS scheduled_for timestamp with time zone,
  ADD COLUMN IF NOT EXISTS scheduled_activate_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded'));

CREATE INDEX IF NOT EXISTS orders_scheduled_due_idx
  ON public.orders (scheduled_activate_at) WHERE status = 'scheduled';

-- Status flow: 'scheduled' may only move to 'placed' (activation) or be cancelled.
CREATE OR REPLACE FUNCTION public.enforce_order_status_flow()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare flow text[]; old_i int; new_i int;
begin
  if new.status = old.status then return new; end if;
  if coalesce(new.channel, 'online') <> 'online' then
    raise exception 'Counter and platform sales cannot change order status';
  end if;
  if old.status in ('completed','cancelled') then
    raise exception 'Order % is already %, its status cannot change', old.code, old.status;
  end if;
  if new.status = 'cancelled' then return new; end if;
  if old.status = 'scheduled' then
    if new.status = 'placed' then return new; end if;
    raise exception 'A scheduled order becomes active automatically at its preparation time';
  end if;
  if new.status = 'scheduled' then
    raise exception 'An active order cannot be moved back to scheduled';
  end if;
  if new.fulfillment = 'delivery' then
    flow := array['placed','confirmed','preparing','ready','out_for_delivery','completed'];
  else
    flow := array['placed','confirmed','preparing','ready','completed'];
  end if;
  old_i := array_position(flow, old.status);
  new_i := array_position(flow, new.status);
  if old_i is null or new_i is null then
    raise exception 'Invalid order status % for this order', new.status;
  end if;
  if new_i <> old_i + 1 then
    raise exception 'Order status can only move forward one step (% -> % is not allowed)', old.status, new.status;
  end if;
  return new;
end $function$;

-- Alerts: scheduled orders queue nothing at creation; they queue the normal
-- staff alert + escalation when they become 'placed'.
CREATE OR REPLACE FUNCTION public.schedule_order_notification_jobs()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_delay integer; v_timeout integer;
begin
  select coalesce(review_reminder_delay_minutes, 5), coalesce(staff_ack_timeout_minutes, 2)
    into v_delay, v_timeout from public.restaurant_settings order by created_at limit 1;
  v_delay := coalesce(v_delay, 5); v_timeout := coalesce(v_timeout, 2);

  if coalesce(new.channel, 'online') = 'online'
     and ((tg_op = 'INSERT' and new.status not in ('completed', 'delivered', 'cancelled', 'scheduled'))
          or (tg_op = 'UPDATE' and old.status = 'scheduled' and new.status = 'placed')) then
    insert into public.notification_jobs (kind, order_id, run_after, dedupe_key)
    values ('staff_new_order', new.id, now(), 'staff_new_order:' || new.id)
    on conflict (dedupe_key) do nothing;
    insert into public.notification_jobs (kind, order_id, run_after, dedupe_key)
    values ('owner_escalation', new.id, now() + make_interval(mins => greatest(v_timeout, 1)),
            'owner_escalation:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'placed' then
    update public.notification_jobs set status = 'cancelled', updated_at = now()
     where order_id = new.id and kind in ('staff_new_order', 'owner_escalation')
       and status in ('pending', 'processing');
  end if;

  if new.user_id is not null and new.status in ('completed', 'delivered')
     and coalesce(new.channel, 'online') = 'online'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notification_jobs (kind, order_id, user_id, run_after, dedupe_key)
    values ('review_reminder', new.id, new.user_id,
            now() + make_interval(mins => greatest(v_delay, 0)), 'review_reminder:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end; $function$;

-- Activates due scheduled orders; called by the existing once-a-minute job.
CREATE OR REPLACE FUNCTION public.activate_due_scheduled_orders()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n integer;
begin
  update public.orders set status = 'placed'
   where status = 'scheduled' and scheduled_activate_at <= now()
     and (payment_status = 'paid' or not exists (
       select 1 from public.restaurant_settings where scheduled_payment_required order by created_at limit 1));
  get diagnostics n = row_count;
  return n;
end $function$;
REVOKE ALL ON FUNCTION public.activate_due_scheduled_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_due_scheduled_orders() TO service_role;
