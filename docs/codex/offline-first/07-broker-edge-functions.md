# Phase 07 — Broker: Supabase Edge Functions

Track B. It needs phase 06, and phase 01 (`packages/pack-format`) on the branch. Read `00-MASTER-PROMPT.md` first; contracts C2, C3, C5, C8 and C9 apply.

## Goal
The only server logic in the new design. Small Supabase Edge Functions (Deno) that:
- hand out short-lived Oracle Object Storage URLs (activity upload, pack download)
- build, sign and upload course packs from Supabase data
- invite users

The Oracle API key and the pack-signing key exist only here.

## Read first
- `apps/api/src/integrations/oci.ts`: the existing OCI request signer.
  - It signs only `(request-target) date host`. That is correct for `PutObject`/`GetObject`, but **wrong for POST/PUT requests with a JSON body**, such as CreatePreauthenticatedRequest. Those must also sign `x-content-sha256`, `content-type` and `content-length`.
  - Follow Oracle's "Request Signatures" documentation exactly.
- `packages/pack-format/` and its README (the Deno import notes from the phase 01 report).
- `supabase/migrations/*` and `supabase/README.md` (phase 06).

## Allowed paths
- Create:
  - `supabase/functions/_shared/{oci.js,auth.js,http.js,pack-format.js,errors.js}` and `supabase/functions/_shared/*.test.mjs`.
  - `supabase/functions/{activity-upload-url,pack-download-url,publish-pack,invite-user}/index.ts`.
  - `supabase/functions/deno.json` (import map: `@supabase/supabase-js` → `jsr:@supabase/supabase-js@2`, `fflate` → `npm:fflate@0.8`).
  - `supabase/scripts/import-jbank.mjs`, `supabase/scripts/sync-pack-format.mjs`.
- Modify `packages/supabase-tests/**` (add tests for `import-jbank`), `supabase/README.md` (add a "Broker" section), root `package.json` (script `"check:edge-sync": "node supabase/scripts/sync-pack-format.mjs --check"`).
- Create `docs/codex/offline-first/reports/07-report.md`.

## Design rules
- **Thin entry points:** each `index.ts` only parses the request, calls a pure handler from `_shared` (plain ESM `.js` with JSDoc, so `node --test` can test it without Deno), and returns the response. Handlers receive their dependencies injected (`{ db, oci, signer, now, env }`).
- **`_shared/pack-format.js`** is a **generated copy** of `packages/pack-format/index.js`, rewritten for Deno (bare `fflate` import resolved by the import map). It is made by `sync-pack-format.mjs`. `--check` fails if the copy is stale, and is part of the master §7 checks from now on. Never edit the copy by hand.
- **Auth (`auth.js`):**
  - Read `Authorization: Bearer <jwt>` and create a per-request supabase-js client with that header, so **RLS decides what the user can read**.
  - Use a separate service-role client only for writes RLS forbids (pack versions, uploads, invites), and only **after** an explicit permission check done through the user client.
  - A missing or invalid JWT gives 401.
- **Errors (`errors.js`):** `{ error: CODE, message }` with the C8 status codes. Never include stack traces, SQL or keys.
- **CORS:** allow only the origins in env `ALLOWED_ORIGINS` (comma-separated: the dashboard domain, plus `tauri://localhost` and `http://tauri.localhost` for the desktop). Answer `OPTIONS` preflight.
- **Limits:** request body ≤ 64 KB, except that `publish-pack` reads from the DB, not the body.

## Tasks
1. **`oci.js`:**
   - `signRequest({ method, url, headers, body, keyId, privateKeyPem })` using Web Crypto RSASSA-PKCS1-v1_5 SHA-256.
     - GET, HEAD and DELETE sign `(request-target) date host`.
     - POST and PUT with a JSON body also sign `x-content-sha256 content-type content-length`.
     - Object `PutObject` signs only the basic set (Oracle's exception for Object Storage PUT). Make the header set an explicit parameter and test both.
   - `createPar({ objectName, accessType: 'ObjectWrite'|'ObjectRead', expiresAt })` calls `POST /n/{ns}/b/{bucket}/p/` and returns the full URL (`https://objectstorage.{region}.oraclecloud.com` + `accessUri`).
   - `putObject({ objectName, bytes, contentType })`.
   - `keyId = {tenancy}/{user}/{fingerprint}`, and the PEM comes from env `OCI_PRIVATE_KEY`, which may contain `\n` escapes; normalise them.
2. **`activity-upload-url`** (C8):
   - Validate `batchId` (UUID), `sizeBytes` (1 to 5 MB) and `sha256` (64 hex).
   - Read the caller's profile through the user client; it must be active and have an org (practice-only owners: 403).
   - Object name: `raw/activity/{org}/{yyyy}/{mm}/{dd}/{userId}-{batchId}.jsonl.gz`, using the **server** UTC date.
   - Return a PAR (`ObjectWrite`) for exactly that object, expiring in 15 minutes.
3. **`pack-download-url`** (C8):
   - Select the `course_pack_versions` row by `packId` **with the user client**; RLS enforces `rls_can_read_pack`. No row gives 404 (do not reveal whether it exists).
   - Return two `ObjectRead` PARs (object and `.sig`), plus `sha256`, `size` and `expiresAt` (15 minutes).
4. **`publish-pack`** (C8):
   - With `{ courseId }`:
     - The caller must pass `rls_can_manage_course` (call it as an RPC through the user client).
     - Load the course, questions (ordered) and **all** tests with the service client.
     - Refuse with 409 `NOT_PUBLISHABLE` when there are no questions, a question has no visible test, or the course is `ARCHIVED`.
     - Version = `max(version) + 1`.
     - Build with `pack-format.buildPack`, sign with `PACK_SIGNING_KEY`, then upload `.lpack` and `.lpack.sig` to `packs/course/{courseId}/{version}.lpack`.
     - Insert the `course_pack_versions` row with the service client, and set the course status to `PUBLISHED`.
     - Return C8.
   - With `{ assessmentId }`: return 501 `ASSESSMENT_PUBLISH_IN_PHASE_10`, with `TODO(offline-integration)`.
   - If the upload fails after the build, nothing is inserted. If the insert fails after upload, the response is 500 and the orphan object is recorded in the log for cleanup (no silent success).
5. **`invite-user`** (C8):
   - Permission: college admins may invite into their own org only, with roles `STUDENT`, `TEACHER` or `COLLEGE_ADMIN`. Platform owners may invite anywhere. Teachers and students get 403.
   - Create the auth user with `auth.admin.createUser({ email, email_confirm: true })`. An existing email gives 409 `USER_EXISTS`.
   - Insert the profile and add `class_members` for the `classIds`, all of which must belong to the same org (else 400, and roll back by deleting the created auth user).
   - Do not send email here. The user signs in with an OTP to their address, which Supabase sends through the SMTP configured by the owner.
6. **`supabase/scripts/import-jbank.mjs`** `--database-url <url> --i-understand-this-writes`:
   - Loads the J bank into one **platform-wide** course "Java Practice (imported, unreviewed)" with `content_status = 'IMPORTED_UNREVIEWED'` and `status = 'DRAFT'`, plus its questions and `question_tests`.
   - **Import the converter from `packages/pack-format`** (phase 01 `import-jplatform` logic), so IDs and test splits are identical.
   - Never writes `solutionCode`. Idempotent (upsert by ID). Without the flag it prints what it would do and exits 1.
   - This is real course content, so it is allowed in production. It stays `DRAFT` until the owner publishes it.
7. **README "Broker" section:**
   - The secrets list (C8), with `supabase secrets set` example commands showing placeholder values only.
   - The deploy commands (`supabase functions deploy <name>`), `ALLOWED_ORIGINS`.
   - How to create the read-only PAR for `packs/lang/` (C3).
   - The bucket settings: private, versioning off, and a lifecycle rule deleting `raw/activity/` after 365 days.

## Tests (`node --test supabase/functions/_shared/*.test.mjs`; add them to the root `pnpm test` through a small package or script, and say which)
- **OCI signing:**
  - Use Oracle's published sample key and signing example from the "Request Signatures" docs page if you can reproduce it exactly; record the URL in the test.
  - Otherwise, generate an RSA key in the test and verify your signature with Web Crypto against the reconstructed signing string.
  - Assert the exact signing string and header list for GET, `PutObject` and POST CreatePAR.
- **activity-upload-url:** a valid request gives a correct object path (the server date is injected); size too big gives 413; a bad sha gives 400; no JWT gives 401; a user without an org gives 403. The PAR body sent to the fake OCI has `ObjectWrite`, the exact object name and a 15-minute expiry.
- **pack-download-url:** a row hidden by RLS (fake user client returns none) gives 404; a visible row gives two PARs.
- **publish-pack:**
  - Permission denied gives 403. No questions gives 409.
  - Success: the fake OCI received both objects; the `.sig` verifies with the public key; the inserted row matches; version increments.
  - An upload failure inserts nothing.
  - The built pack passes `readPack`, contains hidden tests (practice), and contains no field named `solution`.
- **invite-user:**
  - A college admin inviting into another org: 403. A teacher: 403.
  - A duplicate email: 409.
  - A cross-org class: 400 plus rollback (the fake admin client records a delete).
- **`check:edge-sync`:** passes after sync, and fails after a one-character change to `packages/pack-format/index.js` in a temp copy.
- **`packages/supabase-tests`:** `import-jbank` on the test DB loads 240 questions; a re-run changes nothing; no `solutionCode` text; a student cannot read the hidden tests of the imported course (RLS).
- If `deno` is installed, run `deno check supabase/functions/*/index.ts` and record it. If not, mark the Deno type check **Implemented, not verified**.

## Verification
```
node --test supabase/functions/_shared
pnpm check:edge-sync
pnpm test:supabase
```
Plus master §7.

**Blocked without owner credentials:** deploying the functions and one real PAR round trip (upload a 1 KB gzip, download a pack). Write the manual steps in the README.

## Must not
- No service-role reads in place of RLS checks for user-facing reads.
- No keys in code, tests, fixtures or logs. Tests generate their own keys.
- No public bucket. No PAR longer than 15 minutes, except the owner-created language-pack prefix PAR, which this phase does not create.

## Integration notes to leave
- The function URLs and request examples for the desktop (phase 05) and dashboard (phase 09).
- The exact env and secret names.
- Any OCI quirk found.
