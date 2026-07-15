-- migration-month-status.sql — Month-End status board
-- Adds public.client_month_status: one row per client per month tracking progress
-- toward the month-end goal (books coded → month reconciled → report drafted → sent).
-- Written to and read by the "client-next-steps" skill and the CRM's Month-End tab.
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Safe to re-run: drops and recreates policies/trigger.

create table if not exists public.client_month_status (
  client_id      uuid not null references public.clients(id) on delete cascade,
  month          date not null check (month = date_trunc('month', month)::date),
  books_coded    text not null default 'not_started' check (books_coded    in ('not_started','in_progress','done','na')),
  reconciled     text not null default 'not_started' check (reconciled     in ('not_started','in_progress','done','na')),
  report_drafted text not null default 'not_started' check (report_drafted in ('not_started','in_progress','done','na')),
  report_sent    text not null default 'not_started' check (report_sent    in ('not_started','in_progress','done','na')),
  blocker        text,                                     -- short "what's holding this up"
  blocked_on     text check (blocked_on in ('client','jake','none')),
  notes          text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id),
  primary key (client_id, month)
);

create index if not exists idx_cms_month on public.client_month_status(month);

-- keep updated_at honest on every update
create or replace function public.touch_cms_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_cms_touch on public.client_month_status;
create trigger trg_cms_touch
  before update on public.client_month_status
  for each row execute function public.touch_cms_updated_at();

-- ── Row Level Security: access follows the parent client ──
alter table public.client_month_status enable row level security;

drop policy if exists cms_select on public.client_month_status;
create policy cms_select on public.client_month_status
  for select using (public.can_access_client(client_id));

drop policy if exists cms_insert on public.client_month_status;
create policy cms_insert on public.client_month_status
  for insert with check (public.can_edit_client(client_id));

drop policy if exists cms_update on public.client_month_status;
create policy cms_update on public.client_month_status
  for update using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));

drop policy if exists cms_delete on public.client_month_status;
create policy cms_delete on public.client_month_status
  for delete using (public.is_owner());

-- table grant (project has "auto-expose new tables" off; RLS still filters rows)
grant select, insert, update, delete on public.client_month_status to authenticated;
