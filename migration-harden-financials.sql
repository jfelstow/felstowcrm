-- ── Felstow CRM — harden financial columns (run ONCE in the Supabase SQL editor) ──
-- After this, monthly_value / pricing_model / probability cannot be read by a
-- contractor even via the raw API. The owner still sees them through clients_view.
-- Safe to re-run. Tip: click into a blank query, Cmd+A then Delete, paste, Run.
--
-- Why this shape: in Supabase every logged-in user shares the `authenticated`
-- database role, so column GRANTs can't tell "owner" from "contractor" (that's a
-- profiles.role flag). The fix: remove the money columns from what `authenticated`
-- can SELECT on the base table, and let ONLY clients_view read them (as a SECURITY
-- DEFINER view) so it can mask them per-user. Because a definer view skips the base
-- table's row-level security, the view re-applies the per-client row filter itself.

-- 1) Replace blanket column SELECT with the non-financial columns only.
revoke select on public.clients from authenticated;
grant select
  (id, name, primary_contact, email, phone, type, source, stage, status,
   expected_start, notes, created_by, created_at)
  on public.clients to authenticated;

-- 2) clients_view reads + masks the money columns and re-applies row access.
create or replace view public.clients_view with (security_invoker = off) as
select
  id, name, primary_contact, email, phone, type, source, stage, status,
  case when public.is_owner() then pricing_model end as pricing_model,
  case when public.is_owner() then monthly_value end as monthly_value,
  case when public.is_owner() then probability   end as probability,
  expected_start, notes, created_by, created_at
from public.clients
where public.can_access_client(id);

grant select on public.clients_view to authenticated;
