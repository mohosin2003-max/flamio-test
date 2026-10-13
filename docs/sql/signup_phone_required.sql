-- Optional, additive database-side enforcement of the production signup rules.
-- NOT executed by the agent. Review it, then run it yourself in the Supabase
-- SQL editor if you want the database (not just the app) to refuse an account
-- that has no phone number.
--
-- Safety notes:
--   * No DROP / TRUNCATE / DELETE, no data changes.
--   * Applies to NEW rows only. Existing accounts (including accounts that have
--     a phone but no email) are untouched and keep working.
--   * Password is always enforced by Supabase Auth itself.
--   * Email stays optional: nothing below requires an email address.

create or replace function public.enforce_signup_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Accept either a real auth phone or the phone captured in signup metadata.
  if coalesce(nullif(trim(new.phone), ''), nullif(trim(new.raw_user_meta_data ->> 'phone'), '')) is null then
    raise exception 'A phone number is required to create an account';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_signup_phone_trigger on auth.users;

create trigger enforce_signup_phone_trigger
before insert on auth.users
for each row execute function public.enforce_signup_phone();
