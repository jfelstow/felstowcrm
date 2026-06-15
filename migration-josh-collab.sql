-- ─────────────────────────────────────────────────────────────
-- Felstow CRM — migration: contractor Q&A
-- Run ONCE in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run (uses "add column if not exists").
--
-- Adds the ability for a contractor to ask a question on a specific client
-- and for the owner to answer it. Everything else in the contractor-collab
-- update (Next Steps checklist, activity check-off, Team access panel) reuses
-- existing tables/columns and needs NO migration.
-- ─────────────────────────────────────────────────────────────

alter table public.activities add column if not exists answer      text;
alter table public.activities add column if not exists answered_at  timestamptz;
alter table public.activities add column if not exists answered_by  uuid references public.profiles(id);

-- (No new RLS needed: a Question is just an activity row, so the existing
--  activities policies already scope it to the client's grant — a contractor
--  can ask/resolve on clients they can edit; the owner can answer anything.)
