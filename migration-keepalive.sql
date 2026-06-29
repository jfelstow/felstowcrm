-- ─────────────────────────────────────────────────────────────
-- Keep-alive heartbeat — makes the daily GitHub Actions ping perform a
-- REAL database write so Supabase's free-tier inactivity timer resets.
--
-- WHY THIS EXISTS:
-- The old keep-alive pinged /rest/v1/clients with the anon key. But anon has
-- no table grants (RLS app — only `authenticated` can read clients), so every
-- ping was rejected with HTTP 401 *before any query touched the database*.
-- Supabase only counts real DB activity, so the project paused on schedule
-- (2026-06-23) despite 8 consecutive "green" keep-alive runs.
--
-- The fix: a SECURITY DEFINER function the anon role is allowed to EXECUTE,
-- which upserts a single heartbeat row. That is genuine database activity,
-- exposes zero real data, and needs no stored service-role secret.
-- Run this once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.keepalive (
  id        int primary key default 1,
  last_ping timestamptz not null default now(),
  constraint keepalive_singleton check (id = 1)
);

insert into public.keepalive (id) values (1)
  on conflict (id) do nothing;

-- RLS on (Supabase best practice). No policies + no anon table grant means
-- anon can't touch the table directly; it goes through the function below.
-- The SECURITY DEFINER function runs as its owner (postgres, BYPASSRLS), so
-- the write still succeeds.
alter table public.keepalive enable row level security;

-- SECURITY DEFINER: runs as the function owner, so it performs a real write
-- regardless of the caller's role. Returns the new timestamp so the workflow
-- can assert the write actually happened (not just that it got an HTTP 200).
create or replace function public.keepalive()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update public.keepalive set last_ping = now() where id = 1
  returning last_ping;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
