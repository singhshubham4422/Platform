# Phase 09 — Static dashboards for GitHub Pages

Track B, last phase. It needs phase 06, and uses the phase 07 function contracts (C8); it can mock them. Read `00-MASTER-PROMPT.md` first; contracts C1, C8, C9 and C11 apply.

## Goal
A static single-page web app, deployable to GitHub Pages or Cloudflare Pages, that talks **directly to Supabase** with the public anon key and the user's session. All access control is in RLS.

| Role | What they can do |
| --- | --- |
| Student | See their progress, topics, submissions and released feedback |
| Teacher | Manage course content and tests, link courses to classes, publish packs, create draft assessments, review student code and KPIs, give feedback |
| College admin | Manage departments, classes and members, and invite users |
| Platform owner | Manage organizations and invite college admins |

## Read first
- `supabase/migrations/*`, `supabase/README.md` (phase 06): the policy matrix.
- The phase 07 report: the function URLs and bodies.
- `apps/web/src/components/shared/insights.tsx`, `department-dashboard.tsx`: the existing KPI layouts to take ideas from. **Do not import from `apps/web`.**
- `apps/web/src/app/globals.css` (or the Tailwind theme): the brand colours and spacing, to match the look.

## Allowed paths
- Create `apps/dashboard/**` (package `@lplatform/dashboard`, Vite + React 19 + TypeScript strict).
  - Dependencies: `@supabase/supabase-js` 2, `react-router-dom` 7 (**HashRouter** only), `recharts` 2, `@lplatform/language-config`.
  - Dev dependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`, at the versions already used in the repo where they exist.
- Create `.github/workflows/dashboard-pages.yml`.
- Modify `pnpm-lock.yaml`.
- Create `docs/codex/offline-first/reports/09-report.md`.

## Tasks
1. **Config:**
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_FUNCTIONS_URL` (defaulting to `${VITE_SUPABASE_URL}/functions/v1`), plus `VITE_BASE_PATH` for the Vite `base`.
   - If they are missing, the app shows a full-page "Not configured" message; it never falls back to a hard-coded project.
   - **Never** reference a service role key anywhere. Add a test that greps the built `dist/` for `service_role` and `SERVICE_ROLE` and fails if found.
2. **Data layer:**
   - `src/data/source.ts` defines the `DataSource` interface: one method per screen query/mutation, typed with C9 rows.
   - `src/data/supabase-source.ts` implements it with supabase-js.
   - Mock data sources exist **only** under `src/test/` and are never imported by app code; add a lint rule or test that enforces it.
3. **Auth:**
   - Email OTP: `signInWithOtp({ email, options: { shouldCreateUser: false } })`, then `verifyOtp({ email, token, type: 'email' })`.
   - Use one generic message for unknown emails ("If this email is registered, a code has been sent"), so no account enumeration is possible.
   - After login, load the profile. With no profile, or a `DISABLED` one, sign out and show "Account not active".
   - Route by role.
   - The session is stored by supabase-js in `localStorage` (acceptable for this static site; document it). Logout calls `signOut()`.
4. **Screens.** Each has loading, empty and error states. No placeholder numbers: an empty dataset shows an empty state.
   - **Student:**
     - Overview: last 30 days active minutes chart, solved and attempted, streak (consecutive days with `active_minutes > 0`).
     - Topics: a mastery bar list.
     - Submissions: a list with verdict, language and date; the detail shows source read-only and the result list without hidden data.
     - Assessments: score, solved, time and released feedback.
   - **Teacher:**
     - Classes: list, then a class page with `kpi_class_daily` trends and a student table (active minutes, solved, paste ratio, flags) with sort and filter.
     - Student drill-down: their daily KPIs, topics and submissions.
     - Code review: submission source in a `<pre>` with line numbers, results, and a feedback form (`feedback` insert, `released` toggle).
     - Courses: create and edit a course (languages); questions CRUD (statement Markdown text area with preview, limits, topics, starter code per language, visible and hidden tests editor with add, remove and reorder); link or unlink classes; **Publish pack** button calling `publish-pack`, showing the version, or the 409 reason.
     - Assessments: create and edit **drafts** (class, course, choose questions, window, duration, attempts, high-stakes toggle). The **Schedule** button is disabled with "Available in phase 10" plus `TODO(offline-integration)`.
   - **College admin:** departments CRUD, classes CRUD, members (add existing profiles, remove), **Invite user** (calls `invite-user`), and an org overview (active students by day, from `kpi_class_daily` aggregated).
   - **Platform owner:** organizations list and create (name, slug), invite a college admin into an org, and a platform-wide practice courses list (with the `IMPORTED_UNREVIEWED` badge, and publish allowed).
5. **Markdown:** render the statement preview safely. Either use a tiny allow-list renderer written in the app (headings, bold, italic, code, lists, links with `rel="noopener noreferrer"`), or show plain text. **No `dangerouslySetInnerHTML` with unsanitised content.** Say which approach you chose.
6. **UI quality:**
   - Light and dark theme (CSS variables, `prefers-color-scheme` and a toggle).
   - Responsive from 390 px to desktop, with no horizontal page scroll (tables scroll inside their container).
   - Visible focus rings and labelled form fields.
   - Colour contrast at least WCAG AA.
   - The look matches the existing web console's palette.
7. **GitHub Pages workflow (`dashboard-pages.yml`):**
   - Runs on `workflow_dispatch` only.
   - Builds `apps/dashboard` with the repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_BASE_PATH`, then deploys with `actions/upload-pages-artifact` + `actions/deploy-pages`.
   - Pin each action to a full commit SHA, with a comment giving the version.
   - A comment explains that free GitHub Pages needs a public repository, so the owner should publish the dashboard from a separate public repo or use Cloudflare Pages. It contains no secrets.

## Tests
- **Vitest + Testing Library**, with mocks under `src/test/`:
  - The login flow shows the generic message, and the role routing sends each role to its home page.
  - A disabled profile is signed out.
  - Each role's home page renders with mock data and with empty data (empty states shown).
  - The teacher hidden-test editor round trip.
  - The publish-pack 409 message is shown.
  - The student submission detail renders no hidden-test fields even when the mock wrongly includes them. Defence in depth: the component must ignore those fields.
  - The "Not configured" screen.
- **Build test:** `pnpm --filter @lplatform/dashboard build` succeeds, and the `dist/` grep for service keys passes.
- **Playwright** (`apps/dashboard/e2e/`): against `vite preview` with a **mock data source** selected by `VITE_DATA_SOURCE=mock`, which only exists in a test build mode.
  - Every role's main pages at 1280×800 and 390×844, in light and dark.
  - No horizontal overflow, and no console errors.
  - Screenshots go to `apps/dashboard/test-results/` (gitignored).
  - The mock mode must be impossible in a production build: the build fails if `VITE_DATA_SOURCE=mock` is combined with `mode=production`.
- **Live Supabase run:** **Blocked** until the owner provides a project. List the steps in the report.

## Verification
```
pnpm --filter @lplatform/dashboard test
pnpm --filter @lplatform/dashboard build
pnpm --filter @lplatform/dashboard exec playwright test
```
Plus master §7.

## Must not
- No server-side code, no Next.js, and no middleware: this is a static site.
- No service key or OCI value in the client.
- No fake numbers in production screens.
- Do not modify `apps/web`.

## Integration notes to leave
- The required env and repository variables.
- Which screens call which `DataSource` methods.
- What is waiting for phase 10 (assessment scheduling, high-stakes results).
