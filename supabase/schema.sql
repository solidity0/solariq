-- SolarIQ database schema. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Each installer's data is stored per account; row-level security means
-- a signed-in user can only read and change their own rows.

create table if not exists public.user_data (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  key        text        not null check (key in ('solariq_state', 'solariq_crm', 'solariq_installer')),
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_data enable row level security;

drop policy if exists "Own rows: select" on public.user_data;
drop policy if exists "Own rows: insert" on public.user_data;
drop policy if exists "Own rows: update" on public.user_data;
drop policy if exists "Own rows: delete" on public.user_data;

create policy "Own rows: select" on public.user_data
  for select to authenticated using (auth.uid() = user_id);
create policy "Own rows: insert" on public.user_data
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Own rows: update" on public.user_data
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Own rows: delete" on public.user_data
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;
