# Felstow CRM — Runbook

A live, password-protected client pipeline for Felstow Bookkeeping & Consulting.
Static frontend (GitHub Pages) + Supabase backend (Postgres + Auth + Row Level Security).
You (owner) see everything; a contractor sees and edits **only the clients you grant them**.

```
Felstow CRM/
  index.html     app shell + login
  styles.css     Felstow-branded styling
  app.js         all the logic
  config.js      ← your Supabase URL + anon key go here
  schema.sql     run once in Supabase to create tables + security rules
  RUNBOOK.md     this file
```

---

## One-time setup (~15 min)

### 1. Create the Supabase project (free)
1. Go to **supabase.com** → sign up (free tier is plenty).
2. **New project** → name it `felstow-crm`, pick a region near you, set a database password (save it).
3. Wait ~2 min for it to provision.

### 2. Create the tables + security rules
1. In Supabase: **SQL Editor → New query**.
2. Open `schema.sql`, copy the whole thing, paste, click **Run**. You should see "Success".

### 3. Connect the frontend
1. In Supabase: **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. Paste both into `config.js` (replace the placeholders).
   - The anon key is *meant* to be public — the database security rules are what protect the data, so it's safe to commit.

### 4. Create the logins
1. Supabase: **Authentication → Users → Add user** (use "Auto Confirm").
   - Add **yourself** (your email + a password).
   - Add your **contractor** (their email + a password). Send them the password.
2. Make yourself the owner — **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set role = 'owner'
   where id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```
   Leave the contractor as the default `contractor` role.

### 5. Host it (GitHub Pages — same as your dashboards)
1. New GitHub repo, e.g. `felstowcrm`. Upload the 4 files (`index.html`, `styles.css`, `app.js`, `config.js`).
2. **Settings → Pages →** deploy from `main` / root.
3. Live at `https://jfelstow.github.io/felstowcrm/`.

> The login screen *is* the password protection — no StatiCrypt needed. Each person uses their own Supabase login, which is what enforces per-client access.

---

## Giving the contractor access to specific clients

The contractor sees nothing until you grant a client. In Supabase **SQL Editor**:

```sql
-- Grant the contractor view+edit on one client (look up the ids first):
insert into public.client_access (user_id, client_id, can_edit)
values (
  (select id from auth.users where email = 'CONTRACTOR_EMAIL'),
  (select id from public.clients where name = 'CLIENT NAME'),
  true
);
```

To revoke: `delete from public.client_access where ...` the same pair.
(If this gets frequent, tell Claude — we can add an owner-only "manage access" panel to the app.)

---

## Daily use
- **Sign in** at your Pages URL.
- **+ Add client** (owner) to create a prospect; set its stage as it moves down the pipeline.
- Click any client to edit details and **log activity** — set a *Next step + Follow-up date* so it shows in the **Follow-ups** tab.
- Stage auto-sets status: Signed/Onboarding/Active Client → **Active** (counts toward MRR); Lost/Dormant accordingly; everything else → **Prospect**.

## Notes
- The "Active MRR" card sums `monthly_value` of Active clients; "Pipeline value" sums Prospects.
- Contractors can edit clients/activities they're granted; only the owner can add or delete clients and manage access — all enforced in the database, not just the UI.
