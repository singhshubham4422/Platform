# 00 — MASTER PROMPT: build the offline-first platform

Give this whole file to the coding agent (Codex or any other) first. Then give it **one phase file at a time** from the list in §3.
The agent builds the phases. Claude does the final integration and connection pass (§9).

---

## PROMPT (copy everything from here to the end of the file)

You are working in `C:\Users\sshub\Videos\Platform`, a pnpm 12 monorepo with a local Git repository and no remote.
You are building the **offline-first** version of the platform: an offline mix of HackerRank, LeetCode and Google Classroom.
- The student's desktop app downloads language toolchains and course packs, runs code locally against test cases, stores results and activity offline, and syncs when online.
- Oracle Object Storage holds packs and raw activity. Oracle ATP calculates KPIs. Supabase holds operational data and the calculated KPIs. A static GitHub Pages dashboard shows them.

### 1. Read before doing anything, in this order
1. `docs/architecture/12-offline-first-architecture.md` (the design; it is binding)
2. This file, completely, especially §5 (contracts)
3. The phase file you were given
4. `apps/student-desktop/AGENTS.md`, `apps/api/AGENTS.md`
5. `docs/architecture/09-offline-sync-design.md`, `docs/security/security-review.md`
6. The existing code named in the phase file's "Read first" list

Do not start writing code until you have read all of them. If two of them disagree, this file and the phase file win over older docs. If the phase file and this file disagree, stop and report it. Do not guess.

### 2. Non-negotiable rules
1. **Scope:** change only the paths listed under "Allowed paths" in the phase file. If you need another path, stop and say why in the report instead of changing it.
2. **No rewrites:** do not delete, move or rename existing modules. `apps/api` and `apps/web` stay working; they are retired later by the owner, not by you.
3. **Contracts are frozen:** use the names, JSON shapes, table names, command names, object paths and event names in §5 exactly. Do not rename a field to match your style. If a contract is missing something you need, add it as a new optional field, mark it `ADDED BY PHASE NN` in your report, and do nothing more.
4. **Secrets:** never commit `.env`, private keys, API keys, Supabase service keys, OCI keys, ATP wallets or passwords. Never print them in logs or reports. Never generate a production key. Dev and test keys are generated at test time or into `.local/` (already gitignored).
5. **No test data in production paths:** fixtures live only under `tests/`, `fixtures/` or `*.test.*`. The shipped app, edge functions, SQL migrations and dashboard contain no demo users, demo colleges or sample results. Seed scripts for development must refuse when `NODE_ENV=production`.
6. **Security:**
   - Do not weaken RLS, auth checks, signature checks, sandbox limits or file validation to make a test pass.
   - Hidden test cases never reach the JavaScript/React layer of the desktop app or any API response to a student.
   - Student code is never run through a shell.
   - The Supabase **service role** key is used only inside edge functions and ATP, never in the desktop app or dashboard.
7. **Dependencies:** use only the dependencies listed in §6. Need another one? Write the reason in the report and use the smallest well-known option. Pin exact versions in lockfiles.
8. **Git:**
   - Work on branch `offline-first`. Create it from the current `HEAD` if it does not exist.
   - Make one commit per phase with a Conventional Commit message, for example `feat(desktop): language pack manager (phase 02)`.
   - Do not push, add a remote, rebase, force or rewrite history. Do not run `git clean`, `git reset --hard` or `git checkout -- .`.
   - If the working tree has changes you did not make, leave them alone and do not stage them.
9. **Processes:** stop only processes you started, identified by PID. Never delete databases, Docker volumes or Object Storage data you did not create in this task.
10. **Honesty:**
    - Never say "done" because something builds.
    - Allowed status words: **Verified** (exact command and its output in the report), **Implemented, not verified**, **Incomplete**, **Blocked** (state exactly what the owner must provide), **Disabled for safety**.
    - If you need a cloud account, credentials or hardware you do not have, finish everything else, mark that item Blocked and continue. Do not stop the whole phase.
11. **Windows first:** the owner develops on Windows 11 x64. Every command in your report must work in PowerShell. macOS/Linux code paths must compile (`cfg`-gated) but are verified only where the phase says so.

### 3. Phases and order

| File | Phase | Depends on | Can run in parallel with |
| --- | --- | --- | --- |
| `01-pack-format-and-signing.md` | Shared pack formats, signing, pack builder CLI | none | 06 |
| `02-language-pack-manager.md` | Desktop: download, verify and install language runtimes | 01 | 06, 07 |
| `03-local-runner.md` | Desktop: run code with limits, verdicts | 02 (runtime paths) | 06, 07, 08 |
| `04-course-packs-desktop.md` | Desktop: install course packs, Platform → Course → Language → Question UI | 01, 03 | 06, 07, 08 |
| `05-attempts-activity-sync.md` | Desktop: attempts, activity batches, Supabase login, sync | 04, 06, 07 | 08, 09 |
| `06-supabase-schema-rls-auth.md` | Supabase tables, RLS, auth helpers, KPI views | none | 01–04 |
| `07-broker-edge-functions.md` | Supabase Edge Functions: upload/download URLs, publish pack | 01, 06 | 02–04 |
| `08-atp-kpi-pipeline.md` | KPI reference calculator, ATP SQL, publish to Supabase | 06 (KPI tables) | 02–05, 09 |
| `09-dashboards-github-pages.md` | Static dashboards for student, teacher, college admin | 06 | 05, 08 |
| `10-assessments-trust-recheck.md` | Assessments, encrypted hidden tests, signed attempts, late rules, re-check | all above | none |

Two independent agents can run **Track A** (01 → 02 → 03 → 04) and **Track B** (06 → 08 → 09, then 07) at the same time, in separate worktrees.
- Phase 07 needs phase 01's `packages/pack-format`, so Track B merges Track A's phase 01 commit before starting 07.
- The tracks' allowed paths overlap only in `pnpm-lock.yaml`. After merging the tracks, resolve it by running `pnpm install`; never edit the lockfile by hand.
- Phases 05 and 10 run after both tracks are merged.

### 4. Assumed decisions (from §16 of the design; do not change them)
- **D1:** practice and low-stakes work are judged locally. High-stakes assessments are re-checked on sync by an optional Judge0 worker on a college Linux PC.
- **D2:** Supabase Auth with email OTP. SMTP is configured in the Supabase dashboard (Brevo) by the owner, not in code.
- **D3:** the broker is Supabase Edge Functions (Deno).
- **D4:** KPIs are calculated in Oracle ATP. `packages/kpi-calc` is the reference implementation and test oracle, and it also serves as the `pg_cron` fallback specification.
- **D5:** Windows x64 first. macOS/Linux compile only.
- **D6:** for C/C++ on macOS/Linux, use the system compiler when present. Packs exist for Windows.

### 5. Shared contracts (frozen)

#### C1. Identifiers
- Language IDs come from `packages/language-config`: `PYTHON`, `C`, `CPP`, `JAVA`. Never use lowercase in data. Object paths use lowercase (`python`, `c`, `cpp`, `java`).
- OS values: `windows`, `macos`, `linux`. Architecture values: `x86_64`, `aarch64`.
- All IDs are UUID v4 strings unless stated. `packId` is `{courseId}@{version}` for course packs and `{assessmentId}@{version}` for assessment packs.
- Verdicts come from `VERDICTS` in `packages/language-config`: `ACCEPTED`, `WRONG_ANSWER`, `COMPILE_ERROR`, `RUNTIME_ERROR`, `TIME_LIMIT_EXCEEDED`, `MEMORY_LIMIT_EXCEEDED`, `OUTPUT_LIMIT_EXCEEDED`, `JUDGE_UNAVAILABLE`, `SUBMISSION_FAILED`. Use no others.
- Timestamps are ISO-8601 UTC strings with milliseconds, for example `2026-11-24T10:15:30.123Z`.

#### C2. Signing
- Algorithm: **Ed25519**. The signature is detached: file `<name>.sig` contains the base64 (standard, padded) of the 64-byte signature over the **exact bytes** of `<name>`.
- Public key format: base64 of the 32-byte raw public key, one line.
- Two key roles:
  - `release` signs language packs and `packs/lang/index.json`. Held offline by the owner.
  - `pack` signs course and assessment packs. Held as the secret `PACK_SIGNING_KEY` (base64 of the 32-byte seed) in the edge functions.
- The desktop app gets the public keys at **compile time** from env vars `LPLATFORM_RELEASE_PUBKEY` and `LPLATFORM_PACK_PUBKEY` (`option_env!`).
  - In debug builds and tests, if unset, it uses keys from `.local/keys/release.pub` and `.local/keys/pack.pub` when present.
  - In release builds, if unset, every install fails with the error `PACK_KEY_NOT_CONFIGURED`. There is no silent fallback.

#### C3. Object Storage layout (one private bucket, name from config, default `lplatform-files`)
```
packs/lang/index.json                                  release-signed
packs/lang/index.json.sig
packs/lang/{lang}/{version}/{os}-{arch}.zip            release-signed
packs/lang/{lang}/{version}/{os}-{arch}.zip.sig
packs/course/{courseId}/{version}.lpack                pack-signed
packs/course/{courseId}/{version}.lpack.sig
packs/assessment/{assessmentId}/{version}.lpack        pack-signed
packs/assessment/{assessmentId}/{version}.lpack.sig
raw/activity/{organizationId}/{yyyy}/{mm}/{dd}/{userId}-{batchId}.jsonl.gz
backups/postgres/{yyyy-mm-dd}.dump.gz
```
- `packs/lang/` is readable through one owner-created read-only PAR on that prefix. Its base URL is the desktop config `VITE_LANG_PACKS_BASE_URL`, for example `https://objectstorage.ap-hyderabad-1.oraclecloud.com/p/<token>/n/<ns>/b/<bucket>/o/`.
- Everything else is reached only through short-lived URLs from the broker (C8).

#### C4. Language pack index (`packs/lang/index.json`)
```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-24T00:00:00.000Z",
  "packs": [
    {
      "language": "JAVA",
      "version": "21.0.5",
      "os": "windows",
      "arch": "x86_64",
      "size": 71234567,
      "sha256": "<64 lowercase hex>",
      "path": "packs/lang/java/21.0.5/windows-x86_64.zip",
      "sourceFile": "{main}.java",
      "compile": ["{runtime}/bin/javac", "-encoding", "UTF-8", "-d", "{out}", "{src}"],
      "run": ["{runtime}/bin/java", "-Xmx{memMb}m", "-Xss64m", "-cp", "{out}", "{main}"],
      "smokeTest": { "source": "<program printing ok>", "expectedOutput": "ok" },
      "licenseFiles": ["LICENSE", "THIRD_PARTY_NOTICES"]
    }
  ]
}
```
- Placeholders, the only ones allowed:
  - `{runtime}`: the install folder.
  - `{src}`: full path to the source file.
  - `{out}`: the build output folder.
  - `{exe}`: the compiled binary path (C/C++).
  - `{memMb}`: the memory limit.
  - `{main}`: Java only, the main class name detected exactly like `javaMainClass()` in `packages/language-config` (first `public [final] class X`, else `Main`). The question bank uses `public class Solution`.
- Other source files are `main.py`, `main.c`, `main.cpp`, matching `fileName` in `packages/language-config`.
- `compile` is `null` for Python.
- The `.exe` suffix is added to `{exe}` on Windows by the runner, never written in the index.
- The zip's root is the runtime folder. It contains no absolute paths, no `..` and no symlinks; the installer must reject any of these.

#### C5. Course and assessment pack (`.lpack` = zip)
```
manifest.json
questions/{questionId}.json
tests/{questionId}.hidden.json        practice packs (plain)
tests/{questionId}.hidden.enc         assessment packs (encrypted, phase 10)
assets/{name}                         optional images/PDFs
```
`manifest.json`:
```json
{
  "schemaVersion": 1,
  "packId": "<courseId>@3",
  "kind": "COURSE",
  "courseId": "<uuid>",
  "assessmentId": null,
  "organizationId": "<uuid or null for platform-wide practice>",
  "version": 3,
  "minAppVersion": "0.5.0",
  "title": "Data Structures and Algorithms",
  "languages": ["JAVA", "PYTHON", "C", "CPP"],
  "createdAt": "2026-11-24T00:00:00.000Z",
  "questions": [
    { "id": "<uuid>", "title": "Two Sum", "path": "questions/<uuid>.json",
      "hiddenTestsPath": "tests/<uuid>.hidden.json",
      "topics": ["arrays", "hashing"], "difficulty": "EASY", "points": 10, "order": 1 }
  ],
  "files": [ { "path": "questions/<uuid>.json", "sha256": "<hex>", "size": 1234 } ],
  "assessment": null
}
```
- `kind` is `COURSE` or `ASSESSMENT`. `difficulty` is `EASY`, `MEDIUM` or `HARD`.
- `files` lists **every** file in the zip except `manifest.json` itself, with its SHA-256.
- For assessment packs, `assessment` is:
  ```json
  { "opensAt": "...", "closesAt": "...", "durationMinutes": 90, "attemptsAllowed": 3, "gracePeriodMinutes": 10, "keyId": "<uuid>", "highStakes": true }
  ```

`questions/{id}.json`:
```json
{
  "id": "<uuid>", "title": "Two Sum", "statementMd": "…",
  "timeLimitMs": 2000, "memoryLimitMb": 256, "outputLimitKb": 64,
  "starterCode": { "JAVA": "…", "PYTHON": "…" },
  "visibleTests": [ { "id": "v1", "input": "…", "expectedOutput": "…" } ]
}
```
- `tests/{id}.hidden.json` is `{ "tests": [ { "id": "h1", "input": "…", "expectedOutput": "…" } ] }`.
- `tests/{id}.hidden.enc` is that same JSON encrypted with AES-256-GCM, stored as UTF-8 JSON `{ "alg": "A256GCM", "keyId": "<uuid>", "nonce": "<b64 12 bytes>", "ciphertext": "<b64 incl. tag>" }`.

#### C6. Desktop Tauri commands (Rust names; arguments are camelCase from JS)
| Command | Phase | Args | Returns |
| --- | --- | --- | --- |
| `runtimes_list` | 02 | – | `RuntimeInfo[]` |
| `runtimes_available` | 02 | `baseUrl` | `IndexEntry[]` for this OS/arch, signature-verified |
| `runtimes_install` | 02 | `baseUrl, language` | `RuntimeInfo`; emits event `runtime-install-progress` |
| `runtimes_remove` | 02 | `language, version` | `()` |
| `run_custom` | 03 | `language, source, stdin, limits` | `RunResult` (one test, id `custom`) |
| `packs_install_from_url` | 04 | `url, sigUrl, expectedSha256` | `PackInfo` |
| `packs_import_file` | 04 | `path` (a `.lpack` with a `.lpack.sig` next to it) | `PackInfo` |
| `packs_list` | 04 | – | `PackInfo[]` |
| `packs_remove` | 04 | `packId` | `()` |
| `packs_list_questions` | 04 | `packId` | `QuestionSummary[]` |
| `packs_get_question` | 04 | `packId, questionId` | `QuestionView` (visible tests only) |
| `run_question` | 04 (persistence in 05) | `packId, questionId, language, source, mode` (`RUN`/`SUBMIT`) | `RunResult` |
| `attempts_list` | 05 | `packId?, questionId?` | `AttemptRow[]` |
| `attempts_due` / `attempts_ack` | 05 | `limit` / `attemptIds` | `AttemptRow[]` / `usize` |
| `activity_append` | 05 | `events: ActivityEvent[]` | `usize` |
| `activity_seal_batch` | 05 | `maxEvents` | `SealedBatch \| null` (gzip bytes as base64, sha256, count) |
| `activity_ack_batch` | 05 | `batchId` | `()` |
| `device_info` | 05 | – | `{ deviceId, publicKey, monotonicSeq }` |
| `assessment_store_key` | 10 | `assessmentId, keyId, keyB64` | `()` (key goes to OS keychain) |

Types (TypeScript form; Rust structs use `#[serde(rename_all = "camelCase")]`):
```ts
type RuntimeInfo = { language: LanguageId; version: string; path: string; installedAt: string };
type Limits = { timeLimitMs: number; memoryLimitMb: number; outputLimitKb: number };
type TestResult = { testId: string; hidden: boolean; verdict: Verdict; timeMs: number; memoryKb: number;
                    stdout: string | null; stderr: string | null; expectedOutput: string | null; input: string | null };
// For hidden tests stdout, stderr, expectedOutput and input are ALWAYS null.
type RunResult = { attemptId: string; mode: 'RUN' | 'SUBMIT' | 'CUSTOM'; verdict: Verdict;
                   compileOutput: string | null; tests: TestResult[]; passed: number; total: number;
                   totalTimeMs: number; startedAt: string; finishedAt: string };
type PackInfo = { packId: string; kind: 'COURSE' | 'ASSESSMENT'; courseId: string; assessmentId: string | null;
                  version: number; title: string; languages: LanguageId[]; questionCount: number; installedAt: string };
type QuestionSummary = { id: string; title: string; topics: string[]; difficulty: string; points: number; order: number };
type QuestionView = QuestionSummary & { statementMd: string; limits: Limits; starterCode: Partial<Record<LanguageId, string>>;
                                        visibleTests: { id: string; input: string; expectedOutput: string }[] };
```
- The overall `verdict` is the first non-`ACCEPTED` test verdict in test order, `COMPILE_ERROR` when compilation fails, or `ACCEPTED`.
- `RUN` uses visible tests only. `SUBMIT` uses visible then hidden tests.
- Error strings returned by commands are stable codes followed by `: ` and detail, for example `RUNTIME_NOT_INSTALLED: JAVA`. Codes used: `PACK_KEY_NOT_CONFIGURED`, `SIGNATURE_INVALID`, `HASH_MISMATCH`, `UNSAFE_ARCHIVE`, `RUNTIME_NOT_INSTALLED`, `SMOKE_TEST_FAILED`, `PACK_NOT_FOUND`, `QUESTION_NOT_FOUND`, `APP_TOO_OLD`, `ASSESSMENT_LOCKED`, `ASSESSMENT_CLOSED`, `NETWORK`, `IO`.

#### C7. Local SQLite additions (in `src-tauri/src/store.rs` migrations; add new numbered migrations only, never edit old ones)
```sql
runtimes(language TEXT, version TEXT, path TEXT, sha256 TEXT, installed_at TEXT, PRIMARY KEY(language, version))
packs(pack_id TEXT PRIMARY KEY, kind TEXT, course_id TEXT, assessment_id TEXT, version INTEGER, title TEXT,
      path TEXT, sha256 TEXT, manifest_json TEXT, installed_at TEXT)
attempts(attempt_id TEXT PRIMARY KEY, pack_id TEXT, question_id TEXT, assessment_id TEXT, language TEXT, mode TEXT,
         source TEXT, source_sha256 TEXT, verdict TEXT, passed INTEGER, total INTEGER, total_time_ms INTEGER,
         results_json TEXT, started_at TEXT, finished_at TEXT, monotonic_seq INTEGER, signature TEXT,
         synced_at TEXT)
activity_events(event_id TEXT PRIMARY KEY, seq INTEGER, payload_json TEXT, batch_id TEXT)
activity_batches(batch_id TEXT PRIMARY KEY, created_at TEXT, event_count INTEGER, sha256 TEXT, gz BLOB, uploaded_at TEXT)
device(id INTEGER PRIMARY KEY CHECK(id = 1), device_id TEXT, public_key TEXT, monotonic_seq INTEGER)
```
- `results_json` stores `TestResult[]` with hidden fields already nulled.
- The device private key lives in the OS keychain, never in SQLite.
- `RUN` attempts are stored locally but never synced to Supabase. Only `SUBMIT` attempts sync. `CUSTOM` runs are not stored.

#### C8. Broker (Supabase Edge Functions; all need `Authorization: Bearer <user JWT>` unless noted; JSON in and out)
| Function | Body | Response | Rules |
| --- | --- | --- | --- |
| `activity-upload-url` | `{ batchId, sizeBytes, sha256 }` | `{ uploadUrl, objectPath, expiresAt }` | `sizeBytes` ≤ 5 MB; path per C3 using the caller's org and id; PAR is `ObjectWrite`, 15 minutes, single object |
| `pack-download-url` | `{ packId }` | `{ url, sigUrl, sha256, size, expiresAt }` | Caller must be enrolled (C9 `rls_can_read_pack`); 15 minutes |
| `publish-pack` | `{ courseId }` or `{ assessmentId }` | `{ packId, version, objectPath, sha256, size }` | Teacher of that course/assessment or college admin; builds the pack with `packages/pack-format`; signs with `PACK_SIGNING_KEY` |
| `assessment-key` | `{ assessmentId }` | `{ keyId, keyB64, closesAt }` | Phase 10; only enrolled students, only between `opensAt` and `closesAt`; every issue recorded in `assessment_key_issues` (`ADDED BY PHASE 10`) |
| `register-device` | `{ deviceId, publicKey }` | `{ ok: true }` | Phase 10; one row per user and device; a different key for an existing device returns `409 DEVICE_KEY_MISMATCH` (`ADDED BY PHASE 10`) |
| `submit-assessment-attempts` | `{ attempts: [...] }` (≤ 20) | `{ accepted, duplicates, rejected }` | Phase 10; the only way assessment submissions are stored; verifies the device signature and applies the attempts limit, late rule and re-check queue (`ADDED BY PHASE 10`) |
| `invite-user` | `{ email, fullName, role, organizationId, classIds? }` | `{ userId, invited: true }` | Phase 07; college admin (own org, roles `STUDENT`/`TEACHER`/`COLLEGE_ADMIN`) or platform owner (any). Creates the auth user (no password; OTP login) and the profile, and adds class memberships. |

- Errors: HTTP 400, 401, 403, 404, 409, 413 or 503 with `{ "error": "<CODE>", "message": "<text>" }`. 
- Secrets come from the function environment only: `OCI_TENANCY`, `OCI_USER`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY`, `OCI_REGION`, `OCI_NAMESPACE`, `OCI_BUCKET`, `PACK_SIGNING_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (provided by the platform).

#### C9. Supabase tables (schema `public`; phase 06 owns them; everything else only reads/writes them)
`organizations, profiles, departments, classes, class_members, courses, questions, question_tests, class_courses, assessments, assessment_keys, course_pack_versions, submissions, feedback, devices, assessment_key_issues, kpi_student_daily, kpi_student_topic, kpi_assessment`, the view `kpi_class_daily`, and the functions `app_role()`, `app_org()`, `rls_is_class_teacher(class_id)`, `rls_is_class_member(class_id)`, `rls_can_read_course(course_id)`, `rls_can_read_pack(pack_id)`, `rls_can_manage_course(course_id)`. Columns are defined in `06-supabase-schema-rls-auth.md` and are frozen from then on.
- Students never read `question_tests` rows of kind `HIDDEN`. Nobody except `service_role` reads `assessment_keys`.
- `ADDED BY PHASE 10`: the views `assessment_results` (final verdict, late status, re-check status, attempts used, best attempt, points earned) and `assessment_user_results` (score, solved, pending re-checks) are `security_invoker`; `claim_recheck()` is `security definer` and executable by `service_role` only. Students still cannot insert assessment `submissions` directly (RLS requires `assessment_id IS NULL`).

- Roles in `profiles.role`: `STUDENT`, `TEACHER`, `COLLEGE_ADMIN`, `PLATFORM_OWNER`.
- `submissions.id` equals the desktop `attemptId`, so syncing twice is idempotent (`on conflict do nothing`).

#### C10. Activity event (one JSON object per line in the batch `.jsonl.gz`)
```json
{ "eventId": "<uuid>", "seq": 1042, "eventType": "paste_detected", "clientTs": "…", "userId": "<uuid>",
  "organizationId": "<uuid>", "deviceId": "<uuid>", "packId": "<courseId>@3", "questionId": "<uuid>",
  "assessmentId": null, "attemptId": null, "language": "JAVA", "schemaVersion": 2, "metadata": { } }
```
- `seq` is the device monotonic counter (never decreases, survives restarts).
- Event types: the existing desktop names, plus three new ones. Metadata keys are frozen:

| eventType | metadata |
| --- | --- |
| `session_started` (new) | `{ appVersion }` |
| `session_ended` (new) | `{ durationMs }` |
| `question_opened` | `{ language }` |
| `editor_started` | `{ language }` |
| `code_changed` | `{ insertedChars, deletedChars, burstMs }` (one event per typing burst, burst ends after 2 s without keys) |
| `paste_detected` | `{ pastedChars, source }` (`editor` or `external`) |
| `copy_inside_editor` | `{ chars }` |
| `language_changed` | `{ from, to }` |
| `reset_to_starter` | `{}` |
| `draft_saved` | `{ chars }` |
| `run_requested` | `{ mode }` (`RUN` or `CUSTOM`) |
| `execution_completed` | `{ attemptId, mode, verdict, passed, total, totalTimeMs }` |
| `submission_created` | `{ attemptId, verdict, passed, total }` |
| `question_completed` | `{ attemptId }` (first `ACCEPTED` submit for that question) |
| `window_focus_lost` | `{}` |
| `window_focus_gained` | `{ awayMs }` |
| `idle_period` (new) | `{ idleMs }` (no input for ≥ 60 s; emitted when input resumes) |

#### C11. KPI definitions (`packages/kpi-calc` and ATP must produce identical numbers)
These are computed from activity events, grouped by `userId` and by the UTC day of `clientTs`.
- `active_minutes`: sort a user's events for the day by `seq`, then sum `min(gap, 120 s)` over consecutive events, where gap is the difference in `clientTs`. Gaps that contain an `idle_period` contribute 0. Divide by 60 and round to 1 decimal.
- `questions_attempted`: distinct `questionId` with at least one `submission_created`.
- `questions_solved`: distinct `questionId` with at least one `submission_created` whose verdict is `ACCEPTED`.
- `runs`: count of `execution_completed` with mode `RUN`. `submits`: count of `submission_created`. `accepted_submits`: those with verdict `ACCEPTED`.
- `typed_chars`: sum of `insertedChars` over `code_changed`. `paste_chars`: sum of `pastedChars` over `paste_detected` with source `external`.
- `paste_ratio`: `paste_chars / (paste_chars + typed_chars)`, 0 when the denominator is 0. Round to 3 decimals.
- `focus_lost_count`: count of `window_focus_lost`. `idle_minutes`: sum of `idleMs` / 60000, rounded to 1 decimal.
- Topic mastery (`kpi_student_topic`, all time, per topic from the pack manifest): `attempted`, `solved` as above, and `mastery = round(100 * (solved + 1) / (attempted + 2))`.
- Assessment (`kpi_assessment`, per user and assessment):
  - `score`: sum of `points` of questions with an `ACCEPTED` submit.
  - `solved`, `total_questions`.
  - `time_minutes`: active minutes restricted to that assessment's events.
  - `flags`: a text array of
    - `HIGH_PASTE` when `paste_ratio > 0.5` and `paste_chars > 200`
    - `FAST_SOLVE` when an `ACCEPTED` submit comes less than 60 s after that question's `question_opened` and the question's `typed_chars < 50`
    - `MANY_FOCUS_LOSS` when `focus_lost_count > 20`
- Events with a duplicate `eventId` are counted once.

### 6. Allowed dependencies
- **Rust** (in `apps/student-desktop/src-tauri/Cargo.toml`): `ed25519-dalek 2` (default features plus `rand_core`), `sha2 0.10`, `base64 0.22`, `zip 2` (default-features off; `deflate`), `reqwest 0.12` (default-features off; `rustls-tls`, `stream`, `json`), `tokio` (already pulled in by Tauri; features `fs`, `io-util`, `process`, `time`), `futures-util 0.3`, `flate2 1`, `aes-gcm 0.10`, `uuid 1` (`v4`), `rand 0.8`, `wait-timeout 0.2`, `windows-sys 0.59` (Windows only; `Win32_Foundation`, `Win32_System_JobObjects`, `Win32_System_Threading`, `Win32_Security`, `Win32_System_ProcessStatus`), `libc 0.2` (unix only), `tempfile 3` (dev). Keep existing `rusqlite`, `keyring`, `serde`, `serde_json`.
- **JS/TS:** `fflate 0.8`, `@supabase/supabase-js 2`, `react-router-dom 7` (dashboard only, hash router), `recharts 2` (dashboard only), `pg 8` (tests only), `oracledb 6` (ATP verify and keep-alive scripts only, thin mode).
  - Dashboard tooling: `vite`, `@vitejs/plugin-react`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`. Reuse the versions already in the repo.
  - Node built-ins (`node:crypto`, `node:test`) are preferred.
- **Deno** (edge functions): only `jsr:@supabase/supabase-js@2`, `npm:fflate@0.8` and Deno/Web standard APIs.

### 7. Checks that must pass before every phase commit
Run from the repo root in PowerShell. Paste the summary line of each into the report.
```
pnpm install --frozen-lockfile        # when you added a dependency: pnpm install, then commit the lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
cargo +stable fmt --manifest-path apps/student-desktop/Cargo.toml --all -- --check
cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml
pnpm build
```
Once they exist, these are also required for every later phase: `pnpm test:supabase` (from phase 06) and `pnpm check:edge-sync` (from phase 07).
Add the phase's own commands from its "Verification" section. If a check failed before your change (compare with `git stash` **only of your own work**, or by reading the earlier report), say so and do not "fix" unrelated code.

### 8. Report (one per phase)
Write `docs/codex/offline-first/reports/NN-report.md` with these sections:
1. **Summary:** 3–6 lines.
2. **Status table:** each task from the phase file → status word → exact command → result line.
3. **Files changed:** a list.
4. **Contract changes:** anything `ADDED BY PHASE NN`, or "none".
5. **Integration notes for Claude:** what is stubbed, which env vars and config are needed, which TODO markers exist (format `// TODO(offline-integration): …`), and what the next phase must know.
6. **Blocked items:** what the owner must provide.
7. **Commit:** hash and message.

### 9. What Claude does after you (do not do it yourself)
Claude merges the tracks, connects the desktop UI end to end, sets real config values with the owner, runs the full journey on real cloud services, fixes integration bugs and decides what is retired. Leave clear `TODO(offline-integration)` markers instead of guessing at real URLs, keys or account values.

Now read the phase file you were given and start.
