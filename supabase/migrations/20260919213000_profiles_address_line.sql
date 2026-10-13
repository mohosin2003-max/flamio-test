-- Customer profile delivery location: saved at sign-up, pre-filled at checkout.
alter table public.profiles add column if not exists address_line text;
