# Phase 09 — Static dashboards for GitHub Pages

Status: **Implemented** locally. The `apps/dashboard` SPA builds, its unit tests and Playwright tests pass, and the production bundle contains neither the test-only mock source nor any service-role material. Live Supabase sign-in and an actual GitHub Pages deployment are **Blocked** on external accounts/configuration.

## Verification

- `pnpm --filter @lplatform/dashboard test` — 2 files, 24 tests passed (login, role routing, disabled profiles, role homes with data and empty data, hidden-test round trip, publish 409, hidden-result defence, not-configured screen, production mock refusal).
- `pnpm --filter @lplatform/dashboard build` — `tsc --noEmit`, Vite production build and `scripts/check-dist.mjs` passed; `dist/` has no `service_role`/`SERVICE_ROLE` string and no `mock-runtime` chunk.
- `pnpm --filter @lplatform/dashboard exec playwright test` — 81 tests passed: every role's main pages at 1280×800 and 390×844 in light and dark, asserting no horizontal page overflow, no console/page errors, and writing screenshots to the gitignored `apps/dashboard/test-results/`.
- `pnpm --filter @lplatform/dashboard lint` — application code does not import `src/test` modules (only `src/runtime.ts` may, behind the test-mode guard).
- `VITE_DATA_SOURCE=mock vite build` fails with “only allowed in the test build mode”.

## What was built

`apps/dashboard` (`@lplatform/dashboard`): React 19 + TypeScript strict, Vite, HashRouter, recharts, `@supabase/supabase-js`, `@lplatform/language-config`; vitest + Testing Library and Playwright at the repository's existing versions. `pnpm-lock.yaml` was updated.

- `src/runtime.ts` reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and optional `VITE_FUNCTIONS_URL` (default `${VITE_SUPABASE_URL}/functions/v1`). Missing URL/key renders the full-page `NotConfiguredScreen`; there is no hard-coded fallback and no service key in the client.
- `src/data/source.ts` defines one method per screen query/mutation; `supabase-source.ts` implements it with the anon client and bearer-authenticated calls to `invite-user`, `publish-pack` (course and, later, assessment).
- Auth is email OTP (`signInWithOtp` with `shouldCreateUser:false`, then `verifyOtp` type `email`). The send step always shows “If this email is registered, a code has been sent”. A missing profile or `DISABLED` status signs out and shows “Account not active”. The session is persisted by supabase-js in `localStorage`; sign-out clears it.
- Role screens: Student (overview with 30-day active-minutes chart, solved/attempted, streak; topic mastery; submissions and read-only detail; assessment results), Teacher (classes, class KPIs/student table with sort/filter/drill-down, review with line-numbered source and feedback including score override and release, course CRUD, question CRUD with visible/hidden test editor, class linking, publish version/409 message, assessment drafts), College admin (org overview, departments/classes CRUD, members, invite), Platform owner (organizations, org admin invite, platform courses with `IMPORTED_UNREVIEWED` badge and publish).
- Markdown statements use a hand-written allow-list renderer (`src/lib/markdown.tsx`): headings, emphasis, inline code, lists, fenced code and http(s) links only; raw HTML is never rendered and `dangerouslySetInnerHTML` is not used.
- UI uses the web console palette as light/dark CSS variables, `prefers-color-scheme` plus a toggle, responsive layout from 390px, horizontally scrolling table containers, focus rings, labelled fields, and loading/empty/error states on every data screen.
- `src/test/**` holds the mock `DataSource`, auth service and fixtures. They are reachable only through `runtime.ts`, whose `import.meta.env.MODE !== 'test'` branch is removed from production builds; `scripts/check-test-imports.mjs` enforces the import rule.

## GitHub Pages workflow

`.github/workflows/dashboard-pages.yml` is `workflow_dispatch` only, uses repository **variables** only (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_FUNCTIONS_URL`, `VITE_BASE_PATH`), and deploys with `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`, all pinned to full commit SHAs with version comments. A header comment notes that free GitHub Pages needs a public repository, otherwise use a separate public repository or Cloudflare Pages.

## Integration notes

- Repository variables and Pages configuration (source: GitHub Actions) are required before the first run. Set `VITE_BASE_PATH` when the site is served from a subpath.
- Screens call: student overview/topics/submissions/assessments; teacher classes, `kpi_class_daily`, class students, drill-down, review/feedback, course bundle and authoring, `publish-pack`; admin departments/classes/members/profiles/`invite-user`/org overview; owner organizations, courses.
- Assessment scheduling and result details for phase 10 are marked: `TODO(offline-integration): enable assessment scheduling in phase 10` in `TeacherAssessmentEditor.tsx`.
- Live OTP sign-in, RLS-scoped reads against a real Supabase project, and a Pages deployment are Blocked until the owner supplies the project, SMTP (Brevo) and repository variables. Steps: set the four variables, enable Pages with “GitHub Actions” source, run the workflow manually.

## TODO markers

- `TODO(offline-integration): enable assessment scheduling in phase 10` (consumed by phase 10).

## Blocked

- Real Supabase project/OTP login and GitHub Pages publication require owner-supplied configuration.
