# Growity CRM · Phase 1 Foundation

Internal CRM for **Growity Solutions** covering three verticals: Growity Agency (AGY), Scalora (SCL) and Growity Academy (ACD).
Phase 1 covers the foundation: database, security, authentication, the app shell, the dashboard and admin user management.

**Stack:** Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS 4 · shadcn-style UI on Radix · Supabase (Postgres, Auth, RLS) · React Hook Form · Zod · Lucide · Vitest

---

## 1. Quick start (local)

```bash
npm install
cp .env.example .env.local      # then fill in values (section 3)
npm run dev                     # http://localhost:3000
```

Before you can sign in you need a Supabase project with the migrations applied and a first admin (section 2).

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |
| `npm test` | Unit tests for permission, routing and validation logic (Vitest) |
| `npm run test:rls` | Full RLS test suite on a throwaway local Postgres (needs `psql` and a local server, see 6.2) |
| `npm run check:secrets` | After `build`: fails if a server secret appears in the browser bundle |

---

## 2. Supabase setup (one time)

### 2.1 Create the project
Supabase dashboard → New project → region **Mumbai (ap-south-1)**.

### 2.2 Apply the migrations
Use **one** of these:

```bash
# A. Supabase CLI (recommended)
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

B. Or paste each file from `supabase/migrations/` into the SQL Editor, **in filename order**.

### 2.3 Auth settings (required)
Supabase dashboard → **Authentication**:

1. **Sign In / Providers → Email:** turn ON *Email*. Turn **OFF "Allow new users to sign up"** (public self-registration is disabled).
2. **URL Configuration:** Site URL = your app URL (e.g. `https://crm.growity.in`). Add `http://localhost:3000/**` and `https://<your-domain>/**` to Redirect URLs.
3. **Emails → Reset Password template:** replace the link with the line below. It lets the reset link work from any device or browser:
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset password</a>
   ```
4. **Production email:** set up custom SMTP (Authentication → Emails → SMTP). The built-in sender is heavily rate-limited.

### 2.4 Create the first admin
Self-sign-up is off, so the first admin is created by hand once:

1. Authentication → Users → **Add user → Create new user**: enter email and password, and tick *Auto Confirm User*.
2. SQL Editor:
   ```sql
   update public.profiles
   set role = 'admin', is_active = true, full_name = 'Your Name'
   where email = 'you@growity.in';
   ```
   (Accounts created from the dashboard start **inactive** on purpose. Only accounts created by the app's server-side flow start active.)
3. Sign in at `/login`. Add everyone else from **Admin → Users → Add user**.

---

## 3. Environment variables

| Variable | Where | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | yes* | New `sb_publishable_…` key (recommended) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | yes* | Legacy anon key. Used only if the publishable key is empty |
| `NEXT_PUBLIC_SITE_URL` | server | recommended | Base URL for password-reset links |
| `SUPABASE_SECRET_KEY` | **server only** | for adding users | New `sb_secret_…` key (or legacy `SUPABASE_SERVICE_ROLE_KEY`). Never prefix with `NEXT_PUBLIC_` |

\* one of the two.

Without `SUPABASE_SECRET_KEY` the app still runs. **Add user** then shows a clear "not configured" message instead of failing silently.
The secret key is only imported from files marked `server-only`. `npm run check:secrets` verifies it never reaches the client bundle.

---

## 4. Architecture

```
src/
  app/
    (auth)/login, forgot-password, actions.ts   signed-out pages + auth server actions
    reset-password/                             needs a recovery session
    auth/confirm, auth/signout                  email-link callback, logout
    (app)/                                      protected shell (sidebar + top bar)
      dashboard/
      settings/            admin-only (layout guard + RLS)
        users/, users/[id]/, actions.ts
  components/  ui/ layout/ navigation/ dashboard/ forms/ users/
  lib/
    supabase/     browser, server, middleware and admin (server-only) clients
    auth/         session loading, route rules
    permissions/  UI-level role helpers (mirror of the RLS rules)
    validations/  Zod schemas (shared by client and server)
    verticals/    global vertical selection logic
    dashboard/    metrics contract (honest zeros in Phase 1)
  hooks/use-vertical.ts   selected vertical in any client component
  config/                 app constants, navigation
  types/database.ts       typed schema
supabase/
  migrations/   5 ordered SQL migrations (section 5)
  seed.sql      reference data only (no fake users)
  tests/        RLS test suite + local shim
tests/unit/     Vitest suites
```

**Security model:** the database is the authority. RLS policies decide every read and write. A guard trigger decides which columns a user may change. Next.js server actions re-check admin status before doing anything, and the UI only hides what the user couldn't do anyway.

**Verticals:** one centralized app. The selected vertical is stored in an httpOnly cookie, validated on every request against the verticals RLS returns for that user, and exposed through `useVertical()` / `getSessionContext()`. Future `leads`, `customers` and `opportunities` tables must carry `vertical_id` and `owner_id` and use the ready-made policy helpers (section 5.3).

---

## 5. Database

### 5.1 Migrations

| File | Contents |
|---|---|
| `20261115000100_core_schema.sql` | `app_private` schema; tables `profiles`, `verticals`, `user_verticals`, `app_settings`; constraints, indexes, `updated_at` triggers |
| `20261115000200_auth_helpers.sql` | SECURITY DEFINER helpers: role, active status, global access, team tree, accessible verticals, record-level permission helpers |
| `20261115000300_rls_policies.sql` | RLS enabled on every table; table grants (anon gets nothing); all policies |
| `20261115000400_guards_and_provisioning.sql` | Profile creation from `auth.users`; email sync; profile update guard; admin RPCs `admin_list_users`, `admin_set_user_verticals` |
| `20261115000500_seed_reference_data.sql` | AGY / SCL / ACD and the 4 company settings (idempotent) |

### 5.2 Relationships

```
auth.users 1──1 profiles ──┐ manager_id (self-reference, on delete set null)
                profiles 1──* user_verticals *──1 verticals
app_settings (key/value, standalone)
```

### 5.3 Policies

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| profiles | self; admin/cxo all; manager → reporting tree; anyone → own manager | none (auth trigger only) | admin any row; others own row, **name/phone only** (guard trigger) | none (deactivate instead) |
| verticals | admin/cxo all; others assigned only | admin | admin | admin |
| user_verticals | self; admin/cxo all; manager → team | admin | n/a | admin |
| app_settings | any active user | admin | admin | n/a |

Inactive users have no role, so they get **no rows from anything** the moment they are deactivated. The app also bans their auth login when the secret key is configured.

Guard-trigger rules: nobody can grant themselves admin/CXO or change their own manager, status or email. An admin cannot demote or deactivate themselves, and the last active admin can never be removed. A manager must be an active manager, CXO or admin, and reporting loops are rejected.

Provisioning: role from sign-up metadata is **ignored** (always `salesperson`). A profile is active only when `app_metadata.provisioned = true`, which only the server secret key can set.

**For Phase 2 tables**, reuse:
```sql
create policy leads_select on public.leads for select to authenticated
  using ((select app_private.can_view_record(owner_id, vertical_id)));
create policy leads_write on public.leads for update to authenticated
  using ((select app_private.can_manage_record(owner_id, vertical_id)));
```
Scopes: admin all · CXO view all (read-only on business records) · manager own + team within assigned verticals · salesperson own within assigned verticals.

---

## 6. Testing

### 6.1 Unit tests
`npm test` runs 31 tests: role capabilities, admin self-lockout rules, navigation visibility, route protection, open-redirect protection, vertical-cookie tampering, Zod validation and error messages.

### 6.2 RLS tests
`supabase/tests/rls_policies.test.sql` runs every policy as anon, admin, CXO, manager, salesperson, an inactive user and a self-signup. It runs in one transaction and **rolls back**.

- **Locally** (plain Postgres 15+, no Supabase needed):
  ```bash
  PGHOST=localhost PGPORT=5432 PGUSER=postgres npm run test:rls
  ```
  This creates a throwaway `growity_rls_test` database, adds a minimal Supabase auth shim, applies the real migrations and runs the suite.
- **On your Supabase project** (after `db push`; leaves no data behind):
  ```bash
  psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" -f supabase/tests/rls_policies.test.sql
  ```
Expected output: `ALL RLS TESTS PASSED`.

---

## 7. Deployment (Vercel)

1. Push this folder to a private GitHub repo.
2. Vercel → New Project → import the repo (framework auto-detected).
3. Add the environment variables from section 3 for Production (and Preview if used). Mark `SUPABASE_SECRET_KEY` as sensitive.
4. Deploy, then set Supabase **Site URL** and **Redirect URLs** to the Vercel or custom domain (section 2.3).
5. Smoke test: sign in, open Users, add a test user, sign in as them in a private window, check what they can see, then deactivate them.

Any Node 20+ host works the same way (`npm run build && npm start`).
