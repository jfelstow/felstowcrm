-- Felstow Bookkeeping & Consulting — CRM schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Safe to re-run: drops and recreates policies/objects.

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        text not null default 'contractor' check (role in ('owner','contractor')),
  created_at  timestamptz not null default now()
);

create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  primary_contact text,
  email          text,
  phone          text,
  type           text,                 -- Bookkeeping / Consulting / Cash-flow / Cleanup / Brand Sourcing
  source         text,                 -- Referral / Website / Network / Cold outreach
  stage          text not null default 'Lead',
  status         text not null default 'Prospect',  -- Prospect / Active / Lost / Dormant
  pricing_model  text,                 -- Retainer / Hourly / Project
  monthly_value  numeric not null default 0,
  probability    text,                 -- Cold / Warm / Hot
  expected_start date,
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);

create table if not exists public.activities (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  activity_date  date not null default current_date,
  type           text not null default 'Note',   -- Call / Email / Meeting / Note / Task
  note           text,
  next_step      text,
  follow_up_date date,
  done           boolean not null default false,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);

-- Onboarding answers: one row per client, mirrors felstowbookkeeping.com/onboarding.html
create table if not exists public.client_onboarding (
  client_id           uuid primary key references public.clients(id) on delete cascade,
  -- 01 Business basics
  legal_name          text,
  dba                 text,
  entity_type         text,
  ein                 text,
  state_formed        text,
  date_started        date,
  fiscal_year         text,
  biz_address         text,
  industry            text,
  -- 02 Ownership & primary contact
  owners              text,
  contact_name        text,
  contact_role        text,
  contact_email       text,
  contact_phone       text,
  contact_pref        text,
  -- 03 People & payroll
  num_employees       integer,
  num_contractors     integer,
  payroll_provider    text,
  payroll_frequency   text,
  owner_pay           text,
  -- 04 Bank accounts & credit cards
  bank_accounts       text,
  credit_cards        text,
  personal_mixing     text,
  -- 05 Loans & financing
  loans               text,
  -- 06 Business assets
  vehicles            text,
  other_assets        text,
  -- 07 Payment platforms
  platforms           text[],
  venmo_paypal_type   text,
  -- 08 Software & tools
  has_qbo             text,
  qbo_subscription    text,
  other_tools         text,
  receipts_handling   text,
  -- 09 Access & credentials
  access_needed       text[],
  cred_method         text,
  -- 10 Current state of the books
  books_status        text,
  last_reconciled     text,
  last_tax_return     text,
  has_cpa             text,
  previous_bookkeeper text,
  -- 11 Sales tax
  sales_tax           text,
  sales_tax_detail    text,
  -- 12 Goals & anything else
  top_goals           text,
  pain_points         text,
  anything_else       text,
  -- meta
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id)
);

-- Per-client grants: which contractor can touch which client.
create table if not exists public.client_access (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  can_edit  boolean not null default true,
  primary key (user_id, client_id)
);

create index if not exists idx_activities_client on public.activities(client_id);
create index if not exists idx_client_access_user on public.client_access(user_id);

-- ─────────────────────────────────────────────────────────────
-- Helper: is the current user the owner?  (SECURITY DEFINER to avoid RLS recursion)
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_owner()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner'
  );
$$;

-- Can the current user access a given client? (owner OR has a grant row)
create or replace function public.can_access_client(target uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_owner()
      or exists (
        select 1 from public.client_access ca
        where ca.client_id = target and ca.user_id = auth.uid()
      );
$$;

create or replace function public.can_edit_client(target uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_owner()
      or exists (
        select 1 from public.client_access ca
        where ca.client_id = target and ca.user_id = auth.uid() and ca.can_edit
      );
$$;

-- ─────────────────────────────────────────────────────────────
-- Auto-create a profile row whenever a new auth user signs up
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'contractor')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles          enable row level security;
alter table public.clients           enable row level security;
alter table public.activities        enable row level security;
alter table public.client_access     enable row level security;
alter table public.client_onboarding enable row level security;

-- profiles: you can read your own; owner reads all. You can update your own name.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_owner());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_owner());

-- clients: see/edit only accessible clients; owner full control.
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select using (public.can_access_client(id));

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert with check (public.is_owner());

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update using (public.can_edit_client(id)) with check (public.can_edit_client(id));

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
  for delete using (public.is_owner());

-- activities: access follows the parent client.
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select using (public.can_access_client(client_id));

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert with check (public.can_edit_client(client_id));

drop policy if exists activities_update on public.activities;
create policy activities_update on public.activities
  for update using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));

drop policy if exists activities_delete on public.activities;
create policy activities_delete on public.activities
  for delete using (public.can_edit_client(client_id));

-- client_onboarding: access follows the parent client.
drop policy if exists onboarding_select on public.client_onboarding;
create policy onboarding_select on public.client_onboarding
  for select using (public.can_access_client(client_id));

drop policy if exists onboarding_insert on public.client_onboarding;
create policy onboarding_insert on public.client_onboarding
  for insert with check (public.can_edit_client(client_id));

drop policy if exists onboarding_update on public.client_onboarding;
create policy onboarding_update on public.client_onboarding
  for update using (public.can_edit_client(client_id)) with check (public.can_edit_client(client_id));

drop policy if exists onboarding_delete on public.client_onboarding;
create policy onboarding_delete on public.client_onboarding
  for delete using (public.can_edit_client(client_id));

-- client_access: you can see your own grants; only owner manages grants.
drop policy if exists client_access_select on public.client_access;
create policy client_access_select on public.client_access
  for select using (user_id = auth.uid() or public.is_owner());

drop policy if exists client_access_manage on public.client_access;
create policy client_access_manage on public.client_access
  for all using (public.is_owner()) with check (public.is_owner());

-- ─────────────────────────────────────────────────────────────
-- Grant table privileges to the logged-in ("authenticated") role.
-- The RLS policies above still decide which ROWS each user may touch;
-- these grants just let the app's API role reach the tables at all.
-- (Required because the project's "Automatically expose new tables" is off.)
-- ─────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on public.clients, public.activities, public.client_access, public.profiles, public.client_onboarding
  to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Financial column protection: contractors must not see or change
-- pricing_model / monthly_value / probability for their clients.
-- The view masks them on read; the trigger reverts changes on write.
-- ─────────────────────────────────────────────────────────────
create or replace view public.clients_view
  with (security_invoker = on) as
select
  id, name, primary_contact, email, phone, type, source, stage, status,
  case when public.is_owner() then pricing_model end as pricing_model,
  case when public.is_owner() then monthly_value end as monthly_value,
  case when public.is_owner() then probability   end as probability,
  expected_start, notes, created_by, created_at
from public.clients;

grant select on public.clients_view to authenticated;

create or replace function public.protect_client_money()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then
    new.monthly_value := old.monthly_value;
    new.pricing_model := old.pricing_model;
    new.probability   := old.probability;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_client_money on public.clients;
create trigger trg_protect_client_money
  before update on public.clients
  for each row execute function public.protect_client_money();

-- ─────────────────────────────────────────────────────────────
-- After you create your own login, promote yourself to owner by running:
--   update public.profiles set role = 'owner' where id = (select id from auth.users where email = 'YOUR_EMAIL');
-- ─────────────────────────────────────────────────────────────
