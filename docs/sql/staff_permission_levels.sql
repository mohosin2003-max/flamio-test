-- Flamio — staff permission access levels
-- Run once in External Supabase → SQL Editor.
-- Additive only: no existing table, policy, grant or row is changed.
-- Every existing grant keeps behaving exactly as it does today (full access).

alter table public.staff_permissions
  add column if not exists access_level text not null default 'manage';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff_permissions'::regclass
      and conname = 'staff_permissions_access_level_check'
  ) then
    alter table public.staff_permissions
      add constraint staff_permissions_access_level_check
      check (access_level in ('view', 'manage'));
  end if;
end $$;

-- Existing rows predate the column; make their level explicit.
update public.staff_permissions
set access_level = 'manage'
where access_level is null;
