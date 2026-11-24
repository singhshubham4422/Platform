# MASTER PROMPT — offline-first platform, all phases in one file

Give this entire file to the coding agent (Codex or another AI) as one prompt. It contains the master rules and contracts, followed by all ten phases as PART 01 to PART 10. The separate files in `docs/codex/offline-first/` have the same content, one phase per file.

---

## §0. How to work through this file (read first)
- In the text below, "this file", "the master prompt" and `00-MASTER-PROMPT.md` all mean the MASTER SECTION. "The phase file" or "the phase file you were given" means the current PART.
- Read the whole master section, then the PART you are working on, before writing code for it.
- **Execution order for a single agent:** PART 01 → 02 → 03 → 04 → 06 → 07 → 08 → 09 → 05 → 10. This order satisfies every phase's "Depends on" rule.
  - With two agents, use the Track A / Track B split in §3 instead.
- For each PART:
  1. Do its tasks.
  2. Run its verification and the master §7 checks.
  3. Write its report in `docs/codex/offline-first/reports/NN-report.md`.
  4. Make one commit.
  5. Then continue with the next PART **without waiting**.
- When a PART has Blocked items (missing cloud accounts, credentials or hardware), finish everything else in it, report the blocked items, commit, and continue. Stop the whole run only when a PART cannot be started because a phase it depends on failed its required tests. Report that clearly.
- At the end, write `docs/codex/offline-first/reports/FINAL-SUMMARY.md`:
  - one line per PART with its overall status
  - every Blocked item, with what the owner must provide
  - the full `rg "TODO\(offline-integration\)"` output, for Claude's integration pass

---

# MASTER SECTION

You are working in `C:\Users\sshub\Videos\Platform`, a pnpm 12 monorepo with a local Git repository and no remote.
You are building the **offline-first** version of the platform: an offline mix of HackerRank, LeetCode and Google Classroom.
- The student's desktop app downloads language toolchains and course packs, runs code locally against test cases, stores results and activity offline, and syncs when online.
- Oracle Object Storage holds packs and raw activity. Oracle ATP calculates KPIs. Supabase holds operational data and the calculated KPIs. A static GitHub Pages dashboard shows them.

#### 1. Read before doing anything, in this order
1. `docs/architecture/12-offline-first-architecture.md` (the design; it is binding)
2. This file, completely, especially §5 (contracts)
3. The phase file you were given
4. `apps/student-desktop/AGENTS.md`, `apps/api/AGENTS.md`
5. `docs/architecture/09-offline-sync-design.md`, `docs/security/security-review.md`
6. The existing code named in the phase file's "Read first" list

Do not start writing code until you have read all of them. If two of them disagree, this file and the phase file win over older docs. If the phase file and this file disagree, stop and report it. Do not guess.

#### 2. Non-negotiable rules
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

#### 3. Phases and order

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

#### 4. Assumed decisions (from §16 of the design; do not change them)
- **D1:** practice and low-stakes work are judged locally. High-stakes assessments are re-checked on sync by an optional Judge0 worker on a college Linux PC.
- **D2:** Supabase Auth with email OTP. SMTP is configured in the Supabase dashboard (Brevo) by the owner, not in code.
- **D3:** the broker is Supabase Edge Functions (Deno).
- **D4:** KPIs are calculated in Oracle ATP. `packages/kpi-calc` is the reference implementation and test oracle, and it also serves as the `pg_cron` fallback specification.
- **D5:** Windows x64 first. macOS/Linux compile only.
- **D6:** for C/C++ on macOS/Linux, use the system compiler when present. Packs exist for Windows.

#### 5. Shared contracts (frozen)

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
| `assessment-key` | `{ assessmentId }` | `{ keyId, keyB64, closesAt }` | Phase 10; only enrolled students, only between `opensAt` and `closesAt`; every issue recorded in `assessment_key_issues` |
| `register-device` | `{ deviceId, publicKey }` | `{ ok: true }` | Phase 10; one row per user and device |
| `submit-assessment-attempts` | `{ attempts: [...] }` (≤ 20) | `{ accepted, duplicates, rejected }` | Phase 10; the only way assessment submissions are stored; verifies the device signature and applies the attempts limit, late rule and re-check queue |
| `invite-user` | `{ email, fullName, role, organizationId, classIds? }` | `{ userId, invited: true }` | Phase 07; college admin (own org, roles `STUDENT`/`TEACHER`/`COLLEGE_ADMIN`) or platform owner (any). Creates the auth user (no password; OTP login) and the profile, and adds class memberships. |

- Errors: HTTP 400, 401, 403, 404, 409, 413 or 503 with `{ "error": "<CODE>", "message": "<text>" }`. 
- Secrets come from the function environment only: `OCI_TENANCY`, `OCI_USER`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY`, `OCI_REGION`, `OCI_NAMESPACE`, `OCI_BUCKET`, `PACK_SIGNING_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (provided by the platform).

#### C9. Supabase tables (schema `public`; phase 06 owns them; everything else only reads/writes them)
`organizations, profiles, departments, classes, class_members, courses, questions, question_tests, class_courses, assessments, assessment_keys, course_pack_versions, submissions, feedback, devices, assessment_key_issues, kpi_student_daily, kpi_student_topic, kpi_assessment`, the view `kpi_class_daily`, and the functions `app_role()`, `app_org()`, `rls_is_class_teacher(class_id)`, `rls_is_class_member(class_id)`, `rls_can_read_course(course_id)`, `rls_can_read_pack(pack_id)`, `rls_can_manage_course(course_id)`. Columns are defined in `06-supabase-schema-rls-auth.md` and are frozen from then on.
- Students never read `question_tests` rows of kind `HIDDEN`. Nobody except `service_role` reads `assessment_keys`.

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

#### 6. Allowed dependencies
- **Rust** (in `apps/student-desktop/src-tauri/Cargo.toml`): `ed25519-dalek 2` (default features plus `rand_core`), `sha2 0.10`, `base64 0.22`, `zip 2` (default-features off; `deflate`), `reqwest 0.12` (default-features off; `rustls-tls`, `stream`, `json`), `tokio` (already pulled in by Tauri; features `fs`, `io-util`, `process`, `time`), `futures-util 0.3`, `flate2 1`, `aes-gcm 0.10`, `uuid 1` (`v4`), `rand 0.8`, `wait-timeout 0.2`, `windows-sys 0.59` (Windows only; `Win32_Foundation`, `Win32_System_JobObjects`, `Win32_System_Threading`, `Win32_Security`, `Win32_System_ProcessStatus`), `libc 0.2` (unix only), `tempfile 3` (dev). Keep existing `rusqlite`, `keyring`, `serde`, `serde_json`.
- **JS/TS:** `fflate 0.8`, `@supabase/supabase-js 2`, `react-router-dom 7` (dashboard only, hash router), `recharts 2` (dashboard only), `pg 8` (tests only), `oracledb 6` (ATP verify and keep-alive scripts only, thin mode).
  - Dashboard tooling: `vite`, `@vitejs/plugin-react`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`. Reuse the versions already in the repo.
  - Node built-ins (`node:crypto`, `node:test`) are preferred.
- **Deno** (edge functions): only `jsr:@supabase/supabase-js@2`, `npm:fflate@0.8` and Deno/Web standard APIs.

#### 7. Checks that must pass before every phase commit
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

#### 8. Report (one per phase)
Write `docs/codex/offline-first/reports/NN-report.md` with these sections:
1. **Summary:** 3–6 lines.
2. **Status table:** each task from the phase file → status word → exact command → result line.
3. **Files changed:** a list.
4. **Contract changes:** anything `ADDED BY PHASE NN`, or "none".
5. **Integration notes for Claude:** what is stubbed, which env vars and config are needed, which TODO markers exist (format `// TODO(offline-integration): …`), and what the next phase must know.
6. **Blocked items:** what the owner must provide.
7. **Commit:** hash and message.

#### 9. What Claude does after you (do not do it yourself)
Claude merges the tracks, connects the desktop UI end to end, sets real config values with the owner, runs the full journey on real cloud services, fixes integration bugs and decides what is retired. Leave clear `TODO(offline-integration)` markers instead of guessing at real URLs, keys or account values.

Now start with PART 01 and follow the execution order in §0.

---

# PART 01 — Pack formats, signing and the pack builder CLI

_Source file: `docs/codex/offline-first/01-pack-format-and-signing.md`_

Track A, first phase. It can run in parallel with phase 06. Read `00-MASTER-PROMPT.md` first; its rules and contracts C1–C5 apply.

### Goal
One shared, dependency-light package that **creates, signs, reads and verifies** language-pack indexes and course/assessment packs exactly as in contracts C2–C5.
- It works in Node 24 and in Deno (used by phase 07 edge functions).
- It ships a CLI the owner uses to build packs and dev keys.
- It ships a converter that turns the 240-question J bank into the first practice pack source.

### Read first
- `packages/language-config/{index.js,index.d.ts,package.json,index.test.mjs}`: copy this package's style (plain ESM + `.d.ts`, `node --test`, no build step).
- `content/j-platform-question-bank/questions.json`: `meta` + `questions[]` with `slug, title, difficulty (Beginner|Easy|Medium|Hard), category, description, constraints, starterCode, solutionCode, language, testCases[{input, expectedOutput, isHidden}]`.
- `content/j-platform-question-bank/J_PLATFORM_THIRD_PARTY_NOTICES.md`.
- `apps/api/src/db/schema/unified.ts` (`coursePackages`), for awareness only.

### Allowed paths
- Create `packages/pack-format/**`.
- Modify `pnpm-lock.yaml` (adding `fflate`).
- Create `docs/codex/offline-first/reports/01-report.md`.

Nothing else.

### Tasks
1. **Package skeleton:** `packages/pack-format/package.json`.
   - Name `@lplatform/pack-format`, `"type": "module"`, `exports` with `types` and `default`.
   - Scripts: `test` (`node --test`), `lint` (`node --check` on every `.js`/`.mjs` file, matching the repo's lint style; see how other packages lint and keep it equivalent), `typecheck` (`tsc --noEmit -p tsconfig.json` with `allowJs`/`checkJs` over `index.d.ts` only, or omit if language-config has none and say so).
   - Dependency: `fflate` 0.8.x.
   - The `bin` field maps `lplatform-pack` to `bin/pack-builder.mjs`.
2. **Crypto, using only Web Crypto (`globalThis.crypto.subtle`) so it runs unchanged in Deno:**
   - `sha256Hex(bytes) → Promise<string>`: lowercase hex.
   - `generateKeyPair() → { seedB64, publicKeyB64 }`: Ed25519, raw 32-byte seed and public key. Import or export the seed through PKCS#8 with a fixed 16-byte prefix (`302e020100300506032b657004220420`). Document this in a code comment.
   - `signDetached(bytes, seedB64) → Promise<string>` (base64 signature) and `verifyDetached(bytes, sigB64, publicKeyB64) → Promise<boolean>`. A malformed key or signature returns `false`; it never throws.
   - `encryptHiddenTests(json, keyB64, keyId) → Promise<EncFile>` and `decryptHiddenTests(encFile, keyB64) → Promise<object>`: AES-256-GCM, 12-byte random nonce, C5 file shape. A wrong key throws `Error('DECRYPT_FAILED')`.
3. **Validators.** Each is a pure function returning `{ ok: true, value } | { ok: false, errors: string[] }`, with no exceptions for bad input:
   - `validateLangIndex(obj)`: C4. Check languages, OS and arch values, the 64-hex `sha256`, that `path` starts with `packs/lang/` and contains no `..`, that placeholders are only the allowed set, and that `compile` is `null` only for `PYTHON`.
   - `validateManifest(obj)`: C5. `kind` rules: `assessment` is required when `ASSESSMENT` and must be `null` when `COURSE`. `packId` equals `{courseId}@{version}` or `{assessmentId}@{version}`. Each question path appears in `files`. No duplicate question IDs.
   - `validateQuestion(obj)`: C5. Limits are positive integers; `timeLimitMs` ≤ 20000; `memoryLimitMb` ≤ 1024; `outputLimitKb` ≤ 1024; `starterCode` keys are valid language IDs; at least one visible test.
   - `isSafeArchivePath(p)`: rejects absolute paths, drive letters, `..` segments, backslashes, empty segments and paths longer than 200 characters.
4. **Course pack build and read:**
   - `buildPack(source) → Promise<{ bytes, manifest, sha256 }>`. The source shape is `{ kind, courseId, assessmentId, organizationId, version, minAppVersion, title, languages, questions: [{ id, title, topics, difficulty, points, order, statementMd, limits, starterCode, visibleTests, hiddenTests }], assessment, encryption: null | { keyB64, keyId } }`.
     - Writes `manifest.json`, the question files and the hidden-test files (`.hidden.json` when `encryption` is null, `.hidden.enc` otherwise; an `ASSESSMENT` pack must have encryption).
     - Fills `files[]` with hashes.
     - The zip is deterministic: entries sorted by path, fixed modification time `1980-01-01`, the same compression level. The same source gives byte-identical output; test this.
   - `readPack(bytes, { publicKeyB64, sigB64 }) → Promise<{ manifest, questions: Map, hidden: Map | null }>`.
     - Verifies the signature first, then that every zip entry is safe and listed in `files` (or is `manifest.json`), then every hash, then the validators.
     - Hidden tests are returned only when not encrypted.
     - Errors are `Error` with `message` set to a C6 code: `SIGNATURE_INVALID`, `UNSAFE_ARCHIVE`, `HASH_MISMATCH`, or `INVALID_MANIFEST: <detail>`.
   - Size limits: reject packs over 200 MB, more than 5,000 entries, or any single entry larger than 50 MB after decompression (zip-bomb guard).
5. **Language index helpers:**
   - `buildLangIndexEntry({ language, version, os, arch, zipBytes, path, sourceFile, compile, run, smokeTest, licenseFiles })` computes `size` and `sha256`.
   - `buildLangIndex(entries) → { json, bytes }`: pretty-printed with 2 spaces and a trailing newline, entries sorted by language, version, os, arch.
6. **CLI `bin/pack-builder.mjs`.** It never prints a seed or private key; it prints file paths and public keys only.
   - `keygen --role release|pack --out <dir>` writes `<role>.seed` (mode 600 where supported) and `<role>.pub`. It refuses if the files exist, unless `--force` is given.
   - `lang-pack --language JAVA --version 21.0.5 --os windows --arch x86_64 --dir <runtime folder> --out <dir> --seed <file> [--compile-json <file>] [--run-json <file>]`: zips the folder (rejecting symlinks), signs it, and writes `<os>-<arch>.zip`, `.zip.sig` and `entry.json`. Default compile, run and smoke-test arguments per language come from a table in the code and match C4.
   - `lang-index --entries <glob or dir> --out <dir> --seed <file>`: writes `index.json` and `index.json.sig`.
   - `course-pack --source <source.json> --out <dir> --seed <file> [--encrypt-key <file> --key-id <uuid>]`.
   - `verify --file <path> --sig <path> --pub <file|b64> [--kind lang-index|pack]`: exits 0 if valid, 1 otherwise, and prints the error code.
   - `import-jplatform --in content/j-platform-question-bank/questions.json --out <source.json> --course-id <uuid> --version <n> --title <text>`:
     - Map each question to the C5 source shape. Use a UUID v5-style **deterministic** ID from the slug with a fixed namespace constant in code, so re-imports keep IDs.
     - Difficulty mapping: `Beginner` and `Easy` → `EASY`, `Medium` → `MEDIUM`, `Hard` → `HARD`.
     - `topics = [category slug]`, points 10/20/30 by difficulty, order as in the file.
     - `statementMd = description + "\n\n**Constraints:** " + constraints` (when present).
     - `starterCode = { JAVA: starterCode }`.
     - Limits: 2000 ms, 256 MB, 64 KB.
     - `isHidden: false` tests go to `visibleTests` and `isHidden: true` to `hiddenTests`, with IDs `v1…` and `h1…`.
     - Any question with no visible test: move its first hidden test to visible, and list the slug in a printed warning.
     - **Never include `solutionCode`.**
     - Copy `meta.status` (`IMPORTED_UNREVIEWED`) and the notice file into the pack as `assets/NOTICE.md`.
7. **`index.d.ts`** types for every export, matching C4/C5 names exactly.
8. **README** at `packages/pack-format/README.md`: purpose, formats (link to the master contracts), CLI usage with PowerShell examples, and the key-handling rules (release key offline, pack key only as an edge-function secret).

### Tests (`packages/pack-format/test/*.test.mjs`; keys generated per test, nothing committed)
- Sign and verify round trip. Tampering one byte fails. A wrong key fails. A malformed signature returns `false`.
- Encrypt and decrypt round trip; a wrong key gives `DECRYPT_FAILED`.
- `validateLangIndex`: one valid fixture passes. One failing case each for a bad language, bad hash, `..` path, unknown placeholder, and `compile: null` on JAVA.
- `validateManifest`, `validateQuestion`: valid cases plus one failing case per rule above.
- `isSafeArchivePath`: table test of at least 12 cases.
- `buildPack` is deterministic (two builds give equal bytes and equal sha256).
- `readPack`:
  - Valid pack: OK.
  - Signature from another key: `SIGNATURE_INVALID`.
  - Tampered question entry with the signature recomputed: `HASH_MISMATCH`.
  - Extra unlisted entry or `../x` entry, built with raw fflate in the test: `UNSAFE_ARCHIVE`.
  - Oversized entry: rejected.
- An assessment pack without encryption is rejected by `buildPack`. An encrypted pack returns `hidden: null` from `readPack`.
- `import-jplatform` on the real bank:
  - Produces 240 questions with stable IDs (two runs give equal output).
  - No `solutionCode` text appears anywhere in the output (assert by searching for a few known solution snippets).
  - Every question has at least one visible test.
  - The built pack passes `readPack`.
- CLI: run `keygen`, `course-pack` and `verify` in a temp dir with `node:child_process`; `verify` exits 0, and 1 after tampering.

### Verification (add to the report)
```
pnpm --filter @lplatform/pack-format test
node packages/pack-format/bin/pack-builder.mjs keygen --role pack --out .local/keys
node packages/pack-format/bin/pack-builder.mjs import-jplatform --in content/j-platform-question-bank/questions.json --out .local/packs/jbank-source.json --course-id 7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01 --version 1 --title "Java Practice (imported, unreviewed)"
node packages/pack-format/bin/pack-builder.mjs course-pack --source .local/packs/jbank-source.json --out .local/packs --seed .local/keys/pack.seed
node packages/pack-format/bin/pack-builder.mjs verify --file .local/packs/<courseId>/1.lpack --sig .local/packs/<courseId>/1.lpack.sig --pub .local/keys/pack.pub --kind pack
```
Plus the master §7 checks.

### Must not
- No Node-only APIs in `index.js` (`fs`, `path`, `Buffer`, `node:crypto`). Only Web APIs and `fflate`, so Deno can import it. The CLI may use Node APIs.
- No `solutionCode` or reference solutions in any pack.
- No committed keys, generated packs or `.local/` content.

### Integration notes to leave
- The exact import path phase 07 should use from Deno (relative path from `supabase/functions/_shared/`).
- The CLI output layout used under `.local/packs/`.
- The questions moved from hidden to visible during import (slugs).

---

# PART 02 — Desktop language pack manager

_Source file: `docs/codex/offline-first/02-language-pack-manager.md`_

Track A. It needs phase 01 merged on the branch. Read `00-MASTER-PROMPT.md` first; contracts C1, C2, C3, C4, C6 and C7 apply.

### Goal
The student picks a language, and the desktop app installs a ready-to-use toolchain into its own data folder from Oracle Object Storage:
- verified by signature and hash
- resumable after interruption
- smoke-tested before use
- with no admin rights and no system changes

### Read first
- `apps/student-desktop/src-tauri/src/lib.rs`: how commands, `Store` state and `app_data_dir` are set up.
- `apps/student-desktop/src-tauri/src/store.rs`: the migration list style and tests.
- `apps/student-desktop/src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.toml` (workspace), `src-tauri/capabilities/*`, `tauri.conf.json` (CSP).
- `apps/student-desktop/src/lib/local-store.ts`: how TS calls `invoke` and falls back outside Tauri.
- `packages/pack-format/` (phase 01): the formats you are verifying.

### Allowed paths
- Create `apps/student-desktop/src-tauri/src/runtimes/{mod.rs,index.rs,download.rs,install.rs,verify.rs,keys.rs,tests.rs}` and `apps/student-desktop/src-tauri/examples/print_ok.rs` (test helper only).
- Modify:
  - `apps/student-desktop/src-tauri/src/lib.rs`: register commands and state only.
  - `apps/student-desktop/src-tauri/src/store.rs`: add **one new migration** for `runtimes`, plus `runtimes_*` helper functions.
  - `apps/student-desktop/src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.lock`.
- Create `apps/student-desktop/src/lib/runtimes.ts`, `apps/student-desktop/src/lib/runtimes.test.ts`.
- Create `apps/student-desktop/src/components/RuntimeManager.tsx` (a component only; **do not** mount it in `App.tsx`; Claude wires it in).
- Modify `apps/student-desktop/src-tauri/tauri.conf.json`, **only** to add the Object Storage origin pattern to `connect-src` if the download happens from the webview. Downloads must happen in Rust (reqwest), so this should not be needed. If you do not change it, say so.
- Create `docs/codex/offline-first/reports/02-report.md`.

### Tasks
1. **Keys (`keys.rs`):** load the release public key as in C2.
   - Order: `option_env!("LPLATFORM_RELEASE_PUBKEY")`; then, **only** under `cfg(debug_assertions)` or `cfg(test)`, `{repo}/.local/keys/release.pub` found by walking up from `CARGO_MANIFEST_DIR`.
   - If neither is available, return `Err("PACK_KEY_NOT_CONFIGURED: release")`.
   - Expose `verify_detached(bytes, sig_b64, pubkey_b64) -> bool` (ed25519-dalek, strict verification).
2. **Index (`index.rs`):**
   - Fetch `{baseUrl}packs/lang/index.json` and `.sig` with reqwest (rustls, 30 s timeout, 1 MB size cap).
   - Verify the signature before parsing.
   - Parse into Rust structs matching C4 (`serde(rename_all = "camelCase")`, `deny_unknown_fields` off).
   - Validate with the same rules as phase 01 `validateLangIndex` (re-implement them in Rust and test them).
   - Filter to the current OS/arch (`std::env::consts`, mapped to C1 values).
   - Cache the verified index JSON and signature in `{app_data}/runtimes/index.json(.sig)`, so `runtimes_available` works offline from the cache. The cache must be re-verified when it is read.
3. **Download (`download.rs`):**
   - Stream to `{app_data}/runtimes/.partial/{language}-{version}-{os}-{arch}.zip`.
   - Resume with an HTTP `Range` header when a partial file exists and the server answers `206`. Otherwise restart.
   - Hash the stream as it arrives.
   - Abort when the received bytes exceed the index `size`.
   - Emit `runtime-install-progress` events `{ language, stage, receivedBytes, totalBytes, message }`, where stage is `download | verify | extract | smoke | done | error`, at most 10 times per second.
   - Retry network errors 3 times with backoff (1 s, 4 s, 10 s), then fail with `NETWORK: …`.
4. **Verify and install (`verify.rs`, `install.rs`):**
   - Check the SHA-256 against the index (`HASH_MISMATCH`), then the detached signature of the zip from `path + ".sig"` (`SIGNATURE_INVALID`).
   - Extract into `{app_data}/runtimes/{language}/{version}.tmp-<uuid>/`:
     - Reject absolute paths, `..`, drive prefixes, symlinks and entries over 1 GB (`UNSAFE_ARCHIVE`).
     - Total extracted size must not exceed 4× the zip size or 2 GB.
     - Set executable bits on unix for files under `bin/`.
   - **Smoke test:** compile and run `smokeTest.source` with the index's `compile`/`run` templates.
     - Fill placeholders per C4; `{main}` is detected with the same regex as `javaMainClass`.
     - Use a plain `std::process::Command` with a 20 s timeout. Phase 03's limited runner does not exist yet; leave `// TODO(offline-integration): switch smoke test to runner::run_tests` for Claude.
     - The output must match `expectedOutput` after normalisation like `outputsMatch` (CRLF → LF, trailing spaces per line and trailing blank lines ignored), else `SMOKE_TEST_FAILED`.
   - Atomically rename the temp folder to `{app_data}/runtimes/{language}/{version}/` and record the row in `runtimes` (C7) with `sha256`.
   - Keep at most two versions per language. Delete older folders only after the new one is recorded.
   - **Concurrency:** only one install at a time per language (a mutex in state). A second call returns the error `IO: install already running`.
5. **Commands (C6):** `runtimes_list`, `runtimes_available(baseUrl)`, `runtimes_install(baseUrl, language)` (async; runs off the main thread), `runtimes_remove(language, version)` (deletes the folder, then the row).
   - Expose a Rust function `runtimes::resolve(language) -> Result<ResolvedRuntime, String>` returning the newest installed runtime with its index templates, so phase 03 can use it. If none is installed, return `RUNTIME_NOT_INSTALLED: <LANG>`.
   - Store the templates in the DB row or alongside it as `{version}/.lplatform-runtime.json`; your choice, but document it.
6. **Base URL rules:** `baseUrl` must start with `https://` and end with `/`. `http://localhost` and `http://127.0.0.1` are allowed only in debug builds, for tests. Anything else gives `NETWORK: invalid base url`.
7. **TypeScript wrapper (`src/lib/runtimes.ts`):**
   - Typed functions for the four commands, plus `onInstallProgress(cb) → unlisten`.
   - Read the base URL from `import.meta.env.VITE_LANG_PACKS_BASE_URL`. If it is missing, throw a clear error; never hard-code a URL.
   - Outside Tauri, every function throws `Error('DESKTOP_ONLY')`.
8. **Component (`RuntimeManager.tsx`):**
   - Lists available and installed runtimes, with Install, Remove and progress bar per language.
   - Shows error codes as readable messages.
   - Follows the existing desktop styling (classes from `src/styles` / `workspace.css`) and adds no new UI library.

### Tests
- **Rust unit tests (`runtimes/tests.rs`):**
  - Use `tempfile` and a tiny local HTTP server on `127.0.0.1` built with `std::net::TcpListener` in the test. No external crates beyond the allowed list.
  - Generate an Ed25519 key in the test and build a small fake runtime zip.
  - Never use a shell script (`.cmd`, `.bat`, `.sh`) as the fake runtime; the installer must not need a shell.
  - Give the fake runtime's `run` template a helper binary that prints `ok`. Build it as a Cargo example or test helper (`src-tauri/examples/print_ok.rs`, which you may create) and copy it into the fake zip as `bin/print_ok[.exe]`. Document the approach in the report.
  - Cases:
    - Valid install records the row and creates the folder.
    - Tampered zip: `HASH_MISMATCH`.
    - Wrong signature: `SIGNATURE_INVALID`.
    - Zip with `../evil`: `UNSAFE_ARCHIVE`.
    - Index signed with the wrong key is refused.
    - Resume: the server serves the first half and drops; the second call resumes with `Range` and succeeds.
    - Size over the index: aborted.
    - Smoke failure: `SMOKE_TEST_FAILED`, and nothing is recorded.
    - Third version install deletes the oldest.
    - The cached index is re-verified (tampered cache is refused).
    - A release build with no key gives `PACK_KEY_NOT_CONFIGURED`: test the function directly with an injected `None`.
- **Store migration test:** it applies on an existing database created by the current migrations, and leaves existing tables unchanged.
- **TS test (`runtimes.test.ts`, vitest):** `DESKTOP_ONLY` outside Tauri; a missing env var gives a clear error; the progress event type guard works.

### Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runtimes
pnpm --filter @lplatform/student-desktop test
```
Plus master §7. **Optional, manual:** build a real Windows Python embeddable pack with phase 01 `lang-pack`, serve `.local/` with `npx http-server .local -p 8787` in debug, and install it through `RuntimeManager` in `pnpm --filter @lplatform/student-desktop tauri dev`. Record it if done, else mark it **Implemented, not verified**.

### Must not
- No `cmd /c`, `sh -c` or PowerShell to run anything.
- No writes outside `{app_data}/runtimes/`. No PATH or registry changes. No elevation.
- Do not mount the component in `App.tsx` and do not touch the workspace UI.
- Do not download real toolchains in tests.

### Integration notes to leave
- The `ResolvedRuntime` struct and where templates are stored.
- The event name and payload.
- The env var names, and which CSP change (if any) is needed.

---

# PART 03 — Desktop local code runner

_Source file: `docs/codex/offline-first/03-local-runner.md`_

Track A. It needs phase 02 on the branch. Read `00-MASTER-PROMPT.md` first; contracts C1, C4 and C6 apply.

### Goal
Compile and run student code on the student's own machine against test cases, with time, memory, output and process limits. Return the same verdicts the server judge used. This replaces Judge0 for everyday work.

### Read first
- `apps/student-desktop/src-tauri/src/runtimes/` (phase 02): `runtimes::resolve`.
- `packages/language-config/index.js`: `LANGUAGES` (`fileName`, `compileTimeoutMs`, `defaultTimeLimitMs`), `javaMainClass`, `outputsMatch`, `VERDICTS`.
- `apps/api/src/modules/judge/local-dev.provider.ts` and `judge0.provider.ts`: how verdicts were mapped before. Keep the same meaning.

### Allowed paths
- Create `apps/student-desktop/src-tauri/src/runner/{mod.rs,spec.rs,compare.rs,limits_windows.rs,limits_unix.rs,tests.rs}`.
- Create `apps/student-desktop/src-tauri/examples/runner_probe.rs`, a test helper that can sleep, allocate, print a lot, spawn children or exit with a code, depending on its arguments.
- Modify `apps/student-desktop/src-tauri/src/lib.rs` (register `run_custom` only), `src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.lock`.
- Create `apps/student-desktop/src/lib/runner.ts`, `apps/student-desktop/src/lib/runner.test.ts`.
- Create `docs/codex/offline-first/reports/03-report.md`.

### Tasks
1. **Spec (`spec.rs`):**
   ```rust
   pub struct RunSpec { pub language: String, pub source: String, pub tests: Vec<TestCase>, pub limits: Limits, pub mode: Mode }
   pub struct TestCase { pub id: String, pub input: String, pub expected_output: Option<String>, pub hidden: bool }
   ```
   `Limits` and `RunResult` are exactly C6. `expected_output: None` is used for `CUSTOM` mode; the verdict is then `ACCEPTED` if the program exits 0 within limits.
2. **Entry point:** `pub fn run_tests(spec: &RunSpec, rt: &ResolvedRuntime, work_root: &Path) -> RunResult`.
   1. Create the work folder `work_root/run-<uuid>/` containing `src/` and `out/`. Write the source as the language's file name; Java uses `{main}.java` with `{main}` from `javaMainClass` rules.
   2. **Compile** if the template is non-null.
      - Wall limit: `compileTimeoutMs` from language-config (fall back to 10 s), memory 1024 MB, output cap 64 KB.
      - A non-zero exit, or a timeout, gives the overall verdict `COMPILE_ERROR` with `compileOutput` (stderr + stdout, truncated, with absolute work paths replaced by `<work>`). Tests are not run.
   3. **Run each test in order**, as a fresh process with the run template:
      - stdin = input, written on a separate thread then closed.
      - stdout and stderr captured on separate threads with caps. stdout is capped at `outputLimitKb`; exceeding it kills the process and gives `OUTPUT_LIMIT_EXCEEDED`. stderr is capped at 16 KB, silently truncated.
      - Time: CPU and wall limits. Wall = `timeLimitMs × 2 + 1000` ms for JVM start-up; CPU = `timeLimitMs`. Either one exceeded gives `TIME_LIMIT_EXCEEDED`.
      - Memory over `memoryLimitMb` gives `MEMORY_LIMIT_EXCEEDED`. For Java, the JVM's own `OutOfMemoryError` on stderr also maps to MLE.
      - A non-zero exit or a signal gives `RUNTIME_ERROR`.
      - Otherwise compare with `outputsMatch` rules (`compare.rs`, with a unit table test identical to `packages/language-config/index.test.mjs` cases), giving `ACCEPTED` or `WRONG_ANSWER`.
      - Record `timeMs` (wall) and `memoryKb` (peak).
      - **Stop after the first failing hidden test** in `SUBMIT` mode; the remaining hidden tests are not run and are not reported. Visible tests always all run.
   4. For hidden tests set `stdout`, `stderr`, `input` and `expectedOutput` to `None` **before** the struct leaves the function.
   5. Delete the work folder, even on panic (a guard struct with `Drop`).
3. **Windows limits (`limits_windows.rs`):**
   - Create the process suspended (`CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`).
   - Assign it to a new Job Object with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` (or `JOB_MEMORY`), `JOB_OBJECT_LIMIT_PROCESS_TIME` (CPU), `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` = 16 (fork-bomb guard; Java needs a few) and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Also apply `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION` so no crash dialogs appear.
   - Then resume the process.
   - Read the peak memory from `JOBOBJECT_EXTENDED_LIMIT_INFORMATION.PeakProcessMemoryUsed`.
   - Kill means `TerminateJobObject`; always close the job handle (the guard kills any leftovers).
   - If std `Command` cannot create the process suspended, use `CreateProcessW` via `windows-sys` with explicit pipes, and quote arguments with a correct Windows quoting function. Test it with spaces and quotes.
4. **Unix limits (`limits_unix.rs`), compile-checked; run its tests on Linux CI only if available:**
   - `pre_exec` with `setrlimit`: `RLIMIT_CPU`, `RLIMIT_AS` (memory; for Java use `memoryLimitMb + 512` because the JVM reserves address space, and rely on `-Xmx`), `RLIMIT_NPROC` = 64, `RLIMIT_FSIZE` = 16 MB, `RLIMIT_CORE` = 0.
   - `setsid()`; kill the process group on timeout.
   - Peak memory from `wait4` rusage.
5. **Environment for every process:**
   - Clear the environment, then set only `PATH` (the runtime's `bin` and the minimum system dirs), `SYSTEMROOT`, `TEMP` and `TMP` (pointing to the work folder), `HOME`/`USERPROFILE` (pointing to the work folder) and `LANG=C.UTF-8` / `PYTHONIOENCODING=utf-8`.
   - The working directory is the work folder.
   - No inherited handles other than the three pipes.
6. **Concurrency:** at most 2 runs at the same time (a semaphore), so a student's laptop stays usable. Further calls wait.
7. **Command `run_custom(language, source, stdin, limits)`:**
   - Resolves the runtime (`RUNTIME_NOT_INSTALLED` if missing), runs one test with id `custom` in `CUSTOM` mode, and returns `RunResult` with a new `attemptId`.
   - It is not stored anywhere.
   - Limits are clamped to the C5 maximums.
8. **TS wrapper (`src/lib/runner.ts`):** `runCustom(...)`, typed exactly as C6. Outside Tauri it throws `DESKTOP_ONLY`. Export `verdictLabel` re-use: import the existing `src/workspace/verdict-label.ts` if present; do not duplicate it.

### Tests (`runner/tests.rs`; use the `runner_probe` example binary as a fake "runtime", so no real compilers are needed)
- `ACCEPTED`: the probe echoes stdin, and the expected output matches with CRLF and trailing spaces.
- `WRONG_ANSWER`.
- `RUNTIME_ERROR`: exit code 3.
- `TIME_LIMIT_EXCEEDED` (busy loop) **and** a wall-limit case (sleep).
- `MEMORY_LIMIT_EXCEEDED`: allocate 512 MB with a 64 MB limit.
- `OUTPUT_LIMIT_EXCEEDED`: print 10 MB.
- **Fork bomb contained:** the probe spawns children in a loop. The run ends with RE or TLE, and **no probe processes remain** afterwards (check with the job/process list in the test).
- `COMPILE_ERROR` path: the fake compile template exits 1 with a message; tests are not run; `compileOutput` contains no absolute path.
- **Hidden-field nulling:** for hidden tests every sensitive field is `None` and serialises to `null`, and nothing beyond the first failing hidden test is reported.
- **Environment:** the probe prints its environment; it contains none of the parent's variables (set `LPLATFORM_SECRET_TEST=1` in the parent first, and assert it is absent).
- **Arguments with spaces and quotes** reach the probe unchanged (Windows quoting).
- **The work folder is removed** after success, failure and timeout.
- **Real languages (optional):** if `.local/runtimes-test/<lang>/` exists (the owner can unpack real packs there), run Hello World, WA, CE and TLE for each language present. Otherwise skip and print why.

### Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml runner
cargo +stable build --manifest-path apps/student-desktop/Cargo.toml --examples
```
Plus master §7. Record the measured overhead: the time for 10 runs of an empty Python program, if a real runtime is available.

### Must not
- No shell. No `cmd`, `powershell`, `sh` or `bash` anywhere in the runner.
- Do not return hidden test data through any path, including error messages or logs. Do not log source code.
- Do not loosen limits to make a slow machine pass. Adjust the test sizes instead.
- No network blocking in v1 (out of scope). Leave `// TODO(offline-integration): consider WFP/AppContainer network isolation for high-stakes mode`.

### Integration notes to leave
- `run_tests` signature and `ResolvedRuntime` usage.
- Measured timings.
- Known differences between the Windows and unix limits.

---

# PART 04 — Desktop course packs and the offline Platform UI

_Source file: `docs/codex/offline-first/04-course-packs-desktop.md`_

Track A, last phase. It needs phases 01–03 on the branch. Read `00-MASTER-PROMPT.md` first; contracts C1, C2, C5, C6 and C7 apply.

### Goal
The student opens **Platform**, sees their installed course packs (and can import a `.lpack` file), opens a course, chooses a language, installs that language if needed, opens a question, writes code and presses **Run** or **Submit**. Everything works with **no network** after the pack and runtime are installed.

### Read first
- Phases 01–03 code and reports.
- `apps/student-desktop/src/App.tsx`, `src/components/Sidebar.tsx` (`AppSection`, `NAV_ITEMS`).
- `src/workspace/ProgrammingWorkspace.tsx`, `monaco-setup.ts`, `useResizable.ts`, `workspace.css`, `views.css`, `verdict-label.ts`, `preferences.ts`. Reuse the editor setup and styles; **do not edit `ProgrammingWorkspace.tsx`**.
- `src/lib/local-store.ts` (drafts) and `src/lib/outbox.ts` (`recordEvent`).

### Allowed paths
- Create `apps/student-desktop/src-tauri/src/packs/{mod.rs,read.rs,install.rs,question.rs,tests.rs}`.
- Modify:
  - `src-tauri/src/lib.rs`: register the C6 phase-04 commands.
  - `src-tauri/src/store.rs`: one new migration for `packs`, plus helpers.
  - `src-tauri/Cargo.toml`, `apps/student-desktop/Cargo.lock`.
- Create `apps/student-desktop/src/platform/{PlatformHome.tsx,CourseView.tsx,LanguagePicker.tsx,OfflineQuestionWorkspace.tsx,platform.css}`.
- Create `apps/student-desktop/src/lib/packs.ts` and `src/lib/packs.test.ts`.
- Modify `apps/student-desktop/src/App.tsx` and `src/components/Sidebar.tsx`, **only** to add one section `platform` (label "Platform"). It is shown only when `import.meta.env.VITE_OFFLINE_FIRST === '1'`; with the flag off, the app must behave exactly as before.
- Create `docs/codex/offline-first/reports/04-report.md`.

### Tasks
1. **Pack key:** reuse phase 02 `keys.rs` with role `pack`: env `LPLATFORM_PACK_PUBKEY`, dev file `.local/keys/pack.pub`.
2. **Install (`install.rs`):**
   - `packs_install_from_url(url, sigUrl, expectedSha256)`:
     - Download both into `{app_data}/packs/.partial/` (same rules as phase 02: https only except localhost in debug, size cap 200 MB, retries).
     - Check the hash, then the signature, then do a full read (task 3).
     - Move to `{app_data}/packs/{courseId or assessmentId}/{version}.lpack` plus `.sig`, and record the `packs` row with `manifest_json`.
   - `packs_import_file(path)`: the same verification for a local file with a `.sig` next to it (USB or lab distribution). The file is copied, never moved.
   - Installing the same `packId` again is a no-op that returns the existing `PackInfo`.
   - A newer version of the same course **replaces** the older one, which is deleted after the new one is recorded. Drafts are untouched (they key on `questionId`).
   - `minAppVersion` greater than `CARGO_PKG_VERSION` (semver compare) gives `APP_TOO_OLD`.
3. **Read (`read.rs`):**
   - Port the phase 01 `readPack` rules to Rust: safe paths, `files[]` hashes, manifest and question validation, zip-bomb limits.
   - Packs stay zipped on disk; entries are read on demand.
   - Re-verify the pack's signature and SHA-256 every time the app starts, lazily on first open, so a pack edited on disk is refused with `SIGNATURE_INVALID`.
4. **Queries (`question.rs`):**
   - `packs_list`, `packs_remove(packId)`, `packs_list_questions(packId)` (ordered by `order`), and `packs_get_question(packId, questionId)` returning `QuestionView` with **visible tests only**.
   - Hidden test files are never returned by any command.
5. **`run_question(packId, questionId, language, source, mode)`:**
   - Check that `language` is in `manifest.languages`, else `IO: language not offered`.
   - Load the limits and tests:
     - `RUN` uses the visible tests.
     - `SUBMIT` uses visible then hidden, where hidden comes from `.hidden.json` for `COURSE` packs.
     - For an `ASSESSMENT` pack, `SUBMIT` returns `ASSESSMENT_LOCKED: phase 10` for now. Leave `// TODO(offline-integration): phase 10 decrypt`.
   - Resolve the runtime and call `runner::run_tests`. Return `RunResult`.
   - Leave `// TODO(offline-integration): phase 05 persists attempt here` exactly where phase 05 will add persistence.
6. **TS API (`src/lib/packs.ts`):**
   - Typed wrappers for every phase-04 command. Outside Tauri they throw `DESKTOP_ONLY`.
   - Add `getPackDownloadUrl(packId)` and `listCatalog()` that **throw `Error('BROKER_NOT_CONNECTED')`**, with `TODO(offline-integration)` comments. Phases 05 and 07 implement them; do not fake catalog data.
7. **UI (in `src/platform/`):**
   - **`PlatformHome`:**
     - Grid of installed packs (title, question count, languages, version).
     - An **Import pack file** button using the Tauri dialog. If `@tauri-apps/plugin-dialog` is not installed, use a simple path text input and say so in the report. Do not add the plugin without listing it as a dependency change.
     - A disabled **Browse catalog** button with the text "Available when online sync is connected".
     - An empty state.
   - **`CourseView`:** question list grouped by topic, with difficulty badges, points and solved state.
     - Solved state comes from the local attempts table **after phase 05**. For now show none, and leave `TODO(offline-integration)`.
     - Language picker (`LanguagePicker`) limited to `manifest.languages`.
     - If the chosen language's runtime is not installed, show the phase 02 `RuntimeManager` inline for just that language, then continue.
     - The last chosen language per course is remembered in `preferences.ts` storage (follow its style).
   - **`OfflineQuestionWorkspace`:**
     - The statement (render Markdown with the same approach the app already uses; if none exists, show plain preformatted text and say so), the Monaco editor using `monaco-setup.ts`, and resizable panes via `useResizable`.
     - Buttons: **Run** (visible tests), **Custom input** (`run_custom`) and **Submit**.
     - A results panel with per-test verdicts using `verdict-label.ts`. Hidden tests show only "Hidden test N: <verdict>", time and memory.
     - Starter code comes from the question, falling back to the `starterCode` in `packages/language-config`.
     - Drafts autosave through the existing `local-store` draft API with `assignmentId = assessmentId ?? null`.
     - Emit the C10 activity events through the existing `recordEvent`, with the same names and metadata as C10 (`question_opened`, `code_changed` bursts, `paste_detected`, `run_requested`, `execution_completed`, `submission_created`, `question_completed`, focus and idle). Phase 05 changes where these events go. Here, only make sure they are emitted with the right metadata, and include `packId` in ctx (add it to `ActivityEvent` as an optional field, `ADDED BY PHASE 04`).
   - The look must match the existing desktop styling. It must work at the app's minimum width of 1100 px with no horizontal scroll, and support keyboard focus order and visible focus rings.

### Tests
- **Rust:** a pack built in the test (re-implement the minimal zip build in Rust test code, or check in no binaries).
  - Valid install and list.
  - Wrong signature: `SIGNATURE_INVALID`.
  - Tampered entry: `HASH_MISMATCH`.
  - `../` entry: `UNSAFE_ARCHIVE`.
  - Too new: `APP_TOO_OLD`.
  - Re-install is a no-op; a newer version replaces the old.
  - The pack is edited on disk after install and is refused on next read.
  - `packs_get_question` JSON never contains any hidden test input or expected output (serialise and search for a unique marker string placed in the hidden tests).
  - `run_question` RUN vs SUBMIT test counts, using the `runner_probe` runtime from phase 03.
  - Assessment SUBMIT gives `ASSESSMENT_LOCKED`.
- **TS (vitest, Tauri `invoke` mocked):**
  - The `packs.ts` wrappers pass the correct argument names.
  - `BROKER_NOT_CONNECTED` stubs throw.
  - `OfflineQuestionWorkspace` renders a question, calls `run_question` with mode `RUN` on Run and `SUBMIT` on Submit, shows hidden tests without data, and emits `question_opened` and `submission_created` with C10 metadata.
  - With `VITE_OFFLINE_FIRST` unset, the sidebar has no Platform item.

### Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml packs
pnpm --filter @lplatform/student-desktop test
pnpm --filter @lplatform/student-desktop build
```
**Manual, if a real runtime pack is available:**
1. Build the J bank pack (phase 01 commands).
2. Run `$env:VITE_OFFLINE_FIRST='1'; pnpm --filter @lplatform/student-desktop tauri dev`.
3. Import the pack, pick Java, install Java, solve "Hello World Program", Submit, and get `ACCEPTED`.
4. Disconnect the network and repeat with another question.

Record the steps, or mark them **Implemented, not verified**.

### Must not
- Do not edit `ProgrammingWorkspace.tsx` or any server-backed view.
- No catalog or demo packs bundled in the app.
- No hidden test data in the JS layer, the DOM, logs or the error text.

### Integration notes to leave
- Where the attempt persistence hook is.
- Which existing components and styles you reused.
- Any duplicated editor logic that Claude should later merge with `ProgrammingWorkspace`.

---

# PART 05 — Desktop attempts, activity batches, Supabase login and sync

_Source file: `docs/codex/offline-first/05-attempts-activity-sync.md`_

Integration phase. It needs Track A (01–04) and Track B (06, 07) merged on `offline-first`. Read `00-MASTER-PROMPT.md` first; contracts C6, C7, C8, C9 and C10 apply.

### Goal
Everything the student does offline is stored safely on the PC, and reaches the cloud when a connection exists:
- `SUBMIT` attempts go to Supabase `submissions`.
- Activity goes as signed-URL uploads of gzip JSONL to Oracle Object Storage.
- New pack versions and released feedback come back.

The desktop signs in with Supabase Auth (email OTP) when `VITE_OFFLINE_FIRST=1`. With the flag off, the old API login and sync must work exactly as before.

### Read first
- `apps/student-desktop/src/lib/{outbox.ts,local-store.ts,api.ts,coding-api.ts}`, `src/App.tsx`, `src/components/Login.tsx`.
- `src-tauri/src/lib.rs`: `store_auth_session`, `load_auth_session` and `delete_auth_session` (Windows keychain via `keyring`).
- `src-tauri/src/store.rs`: the outbox/backoff logic to reuse.
- Phases 04, 06 and 07 reports (the hook location, the C9 columns, the function URLs).

### Allowed paths
- Create `apps/student-desktop/src-tauri/src/{attempts.rs,activity.rs,device.rs,secrets.rs}` and their tests.
- Modify `src-tauri/src/lib.rs` (register commands), `src-tauri/src/store.rs` (new migrations for `attempts`, `activity_events`, `activity_batches` and `device` only), `src-tauri/src/packs/*` (only the persistence hook in `run_question`), `src-tauri/Cargo.toml`, `Cargo.lock`.
- Create `apps/student-desktop/src/lib/{supabase-client.ts,offline-sync.ts,catalog.ts}` and tests; `src/components/{SupabaseLogin.tsx,SyncStatus.tsx}`.
- Modify:
  - `src/lib/packs.ts`: implement `getPackDownloadUrl` and `listCatalog`.
  - `src/lib/outbox.ts`: route `recordEvent` to `activity_append` when the flag is on.
  - `src/platform/*`: solved state, catalog browsing, sync status.
  - `src/App.tsx`: choose the login and sync engine by flag.
  - `apps/student-desktop/package.json`: add `@supabase/supabase-js`.
  - `.env.example` at the repo root: add the new `VITE_*` names with empty values.
- Create `docs/codex/offline-first/reports/05-report.md`.

### Tasks
1. **Secrets abstraction (`secrets.rs`):**
   - A trait `SecretStore { get, set, delete }`, with a keyring implementation (Windows; on other OSes it returns `IO: secure storage unavailable`) and an in-memory implementation used only under `cfg(test)`.
   - Move nothing that exists. Only add new uses: the device private key (`lplatform/device-key`), and later the phase 10 assessment keys.
2. **Device (`device.rs`):**
   - On first use, generate `deviceId` (UUID v4) and an Ed25519 key pair. The private seed goes to `SecretStore`; the `device_id` and `public_key` go to the C7 `device` row with `monotonic_seq = 0`.
   - `next_seq()` increments and persists **in the same SQLite transaction** as the row that uses it, so it never repeats after a crash.
   - Command `device_info` (C6).
   - `sign(bytes)` is used by attempts.
3. **Attempts (`attempts.rs`), the hook in `run_question`:**
   - After every `RUN` and `SUBMIT`, insert an `attempts` row (C7) with `source_sha256`, `results_json` (hidden fields already null), `monotonic_seq = next_seq()`, and `signature = base64(sign(canonical_json))`.
     - `canonical_json` is the attempt fields in this fixed key order: `attemptId, packId, questionId, assessmentId, language, mode, sourceSha256, verdict, passed, total, totalTimeMs, startedAt, finishedAt, monotonicSeq, deviceId`. Write it down in a code comment; phase 10 verifies it server-side.
   - `CUSTOM` runs are not stored.
   - Commands:
     - `attempts_list(packId?, questionId?)`: newest first, max 200.
     - `attempts_due(limit)`: unsynced `SUBMIT` attempts, oldest first.
     - `attempts_ack(attemptIds)`: sets `synced_at`.
   - Source text is kept locally (the student's own work).
4. **Activity (`activity.rs`):**
   - `activity_append(events)`: assigns `seq = next_seq()` and `deviceId` (overriding whatever the client sent), validates `eventType` against the C10 list (unknown types are rejected and counted, not stored), and caps each event's `payload_json` at 4 KB.
   - `activity_seal_batch(maxEvents)`: takes up to `maxEvents` (default 2,000) unbatched events in `seq` order and builds JSONL (one C10 object per line, `schemaVersion: 2`). It gzips the result (`flate2`), computes its SHA-256, stores the batch row (`gz` BLOB), marks the events with the `batch_id` and returns `{ batchId, gzBase64, sha256, sizeBytes, eventCount }`.
     - With no events it returns `null`.
     - If an unuploaded sealed batch exists, it returns that batch instead of sealing a new one, so the order is kept.
   - `activity_ack_batch(batchId)`: sets `uploaded_at`, then deletes that batch's events and BLOB.
   - **Retention guard:** if more than 200,000 events are pending, the oldest `code_changed` events are merged into hourly summaries (same type; metadata summed). Never drop submission or assessment events. Log the merge count.
5. **Supabase client (`supabase-client.ts`):**
   - `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, { auth: { storage: keychainStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`.
   - `keychainStorage` stores the session JSON with the existing `store_auth_session`, `load_auth_session` and `delete_auth_session` commands.
   - It never uses `localStorage` for tokens in Tauri.
6. **Login (`SupabaseLogin.tsx`):**
   - Email, then OTP code (`shouldCreateUser: false`), using the same generic message rule as phase 09.
   - Load the profile. With the role not `STUDENT`, show "Use the web dashboard" and sign out.
   - After login, set the identity used for activity events (`userId`, `organizationId`).
   - Reuse the existing `Login.tsx` styling.
7. **Catalog (`catalog.ts`, `packs.ts`):**
   - `listCatalog()` selects the readable published courses with their latest `course_pack_versions` row (RLS filters them) and marks each as installed, update available, or not installed.
   - `getPackDownloadUrl(packId)` calls the broker `pack-download-url`, then `packs_install_from_url`.
   - In `PlatformHome`, **Browse catalog** now works.
8. **Sync engine (`offline-sync.ts`):**
   - Runs on start (if online), on the `online` event, every 5 minutes while online, and from a **Sync now** button.
   - One run at a time. Exponential backoff with jitter on failure (30 s up to 30 minutes).
   - Order:
     1. Get the session. With none, or a refresh failure (401), pause and show "Sign in to sync".
     2. **Attempts:** take `attempts_due(50)`, map them to `submissions` rows (C9; `course_id` from the pack manifest; `organization_id` left to the trigger), and `upsert` with `onConflict: 'id', ignoreDuplicates: true`. On success, `attempts_ack`. On a 4xx other than 401, park the attempt with its error, shown in `SyncStatus`, and do not retry endlessly. Repeat until none are left.
     3. **Activity:** `activity_seal_batch`, then broker `activity-upload-url` with `{ batchId, sizeBytes, sha256 }`, then `PUT` the gz bytes to `uploadUrl` with `Content-Type: application/gzip`, then `activity_ack_batch`. Repeat while batches exist, at most 10 per run.
     4. **Pull:** check `listCatalog()` for installed courses with a newer version. Auto-install if the pack is under 50 MB; otherwise show **Update available**. Fetch released `feedback` for the user's submissions and cache it for display with `store_put_course` style JSON caching, or a small new cache. Document which.
   - **Duplicate safety:** a crash between upload and ack re-sends the same `batchId`. The object path is the same, so it overwrites with identical bytes; this is harmless. Attempts are idempotent by ID.
9. **Activity identity:**
   - With the flag on, `recordEvent` adds `userId`, `organizationId`, `packId`, `language` and `assessmentId` from the current context, and calls `activity_append` (batching calls every 2 s or 50 events).
   - It emits `session_started`, `session_ended` and `idle_period` (60 s without input in the workspace) per C10.
   - With the flag off, the old `postEvents` path is unchanged.
10. **UI:**
    - `SyncStatus` in the sidebar footer shows pending submissions, pending activity batches, parked errors, the last successful sync time, and **Sync now**.
    - `CourseView` solved state uses `attempts_list` (a question is solved when any `SUBMIT` was `ACCEPTED`).
    - The workspace shows the attempt history for the question.
    - Released feedback is shown in the question view.

### Tests
- **Rust:**
  - `seq` is strictly increasing across store reopen, and no duplicate appears after a simulated crash (drop the connection mid-way).
  - Attempt rows for `RUN`/`SUBMIT` have hidden fields nulled.
  - The signature verifies with the stored public key over the documented canonical JSON.
  - `CUSTOM` is not stored.
  - `attempts_due` returns only unsynced `SUBMIT` attempts.
  - `seal_batch` returns the same unuploaded batch until acked; the gz decompresses to valid C10 lines with the correct `deviceId` and `seq`.
  - An unknown event type is rejected.
  - The retention guard merges only `code_changed`.
  - `SecretStore` is in-memory in tests; nothing touches the real keychain during tests.
- **TS (vitest; mock Tauri `invoke`, supabase-js and `fetch`):**
  - The sync order is attempts → activity → pull.
  - A 401 pauses the engine.
  - A PUT failure keeps the batch (no ack) and backs off.
  - A duplicate attempt upsert counts as success.
  - A parked 4xx attempt does not block later attempts.
  - Flag off: `recordEvent` still calls `postEvents`, and the Supabase client is never created.
  - Login rejects non-student roles.
  - The catalog marks update available correctly.
- **Optional live run (Blocked without the owner's Supabase project and bucket):** sign in, do work offline, sync, and confirm the rows in `submissions` and the object in `raw/activity/…`.

### Verification
```
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml
pnpm --filter @lplatform/student-desktop test
$env:VITE_OFFLINE_FIRST='1'; pnpm --filter @lplatform/student-desktop build
pnpm --filter @lplatform/student-desktop build
```
Plus master §7.

### Must not
- No tokens or keys in SQLite, logs or `localStorage` (in Tauri).
- No changes to the API-backed flow when the flag is off.
- No direct writes to Object Storage except through broker-issued URLs.
- Never sync `RUN` attempts or hidden test data.

### Integration notes to leave
- The canonical JSON definition.
- The env vars.
- Where feedback is cached.
- Measured sync time for 1,000 events and 50 attempts against mocks.

---

# PART 06 — Supabase schema, RLS, auth helpers and KPI tables

_Source file: `docs/codex/offline-first/06-supabase-schema-rls-auth.md`_

Track B, first phase. No dependencies; it can run in parallel with phases 01–04. Read `00-MASTER-PROMPT.md` first; contracts C1, C9 and C11 apply.

### Goal
The complete Supabase Postgres schema for the offline-first platform:
- tables
- row-level security
- helper functions
- KPI serving tables and the class view
- a production-safe owner bootstrap

The J question bank importer is in phase 07, because it needs phase 01.

All of it is tested on the local PostgreSQL cluster with a stub of Supabase's `auth` schema, so no Supabase account is needed to verify it.

### Read first
- `apps/api/src/db/migrations/003_unified_platform.ts`: the existing RLS style and helper functions. Reuse the ideas; do **not** import from the API.
- `apps/api/src/db/bootstrap.ts`: copy its owner-bootstrap rules (strong password not needed here because login is OTP; reject `.test`, `example.*` and `demo` domains).
- `scripts/local-postgres.mjs`: how the local cluster on port 54330 is started.
- `docs/security/security-review.md`.

### Allowed paths
- Create `supabase/config.toml` (project id placeholder `lplatform`; auth: email OTP enabled, `enable_signup = false`, OTP expiry 600 s; SMTP left commented with `# configured in dashboard: Brevo`).
- Create `supabase/migrations/20261124000001_core.sql`, `…0002_content.sql`, `…0003_work.sql`, `…0004_kpi.sql`, `…0005_rls.sql`.
- Create `supabase/scripts/bootstrap-owner.mjs`.
- Create `supabase/README.md`.
- Create `packages/supabase-tests/**` (package `@lplatform/supabase-tests`, dev dependency `pg` 8, `node --test`).
- Modify `scripts/local-postgres.mjs`: **add** a `supabase-test` command that creates the database `lplatform_supabase_test`, applies `supabase/tests-support/auth-stub.sql` and then all `supabase/migrations/*.sql` in name order, and runs `pnpm --filter @lplatform/supabase-tests test` with `SUPABASE_TEST_DATABASE_URL` set. Existing commands must behave exactly as before.
- Create `supabase/tests-support/auth-stub.sql`.
- Modify root `package.json`: add the script `"test:supabase": "node scripts/local-postgres.mjs supabase-test"`.
- Create `docs/codex/offline-first/reports/06-report.md`.

### The auth stub (`supabase/tests-support/auth-stub.sql`; test only, never deployed)
- Creates the roles `anon`, `authenticated` and `service_role` (NOLOGIN; `service_role` BYPASSRLS) if they are missing.
- Schema `auth` with table `auth.users(id uuid primary key, email text unique not null, created_at timestamptz default now())`.
- Functions `auth.uid()` returning `(current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid` and `auth.role()`, the same shape as Supabase's.
- Grants: `usage` on `auth` to `anon` and `authenticated`.

### Schema (frozen after this phase; every table has RLS enabled **and forced**)
All IDs are `uuid default gen_random_uuid()` unless noted. All timestamps are `timestamptz`.

**Core (`0001_core.sql`):**
- `organizations(id pk, name text not null, slug text unique not null check (slug ~ '^[a-z0-9-]{3,64}$'), status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED')), created_at default now())`
- `profiles(id uuid pk references auth.users(id) on delete cascade, organization_id uuid references organizations, role text not null check (role in ('STUDENT','TEACHER','COLLEGE_ADMIN','PLATFORM_OWNER')), full_name text not null, email text not null, department_id uuid null, status text not null default 'ACTIVE' check (status in ('ACTIVE','DISABLED')), created_at default now())`
  - Check: `organization_id` is null only when the role is `PLATFORM_OWNER`.
- `departments(id pk, organization_id uuid not null references organizations, name text not null, code text not null, created_at, unique (organization_id, code))`
- `classes(id pk, organization_id uuid not null references organizations, department_id uuid references departments, name text not null, code text not null, academic_year text, semester int check (semester between 1 and 12), created_at, unique (organization_id, code))`
- `class_members(class_id uuid references classes on delete cascade, user_id uuid references profiles on delete cascade, role text not null check (role in ('STUDENT','TEACHER')), added_at default now(), primary key (class_id, user_id))`

**Content (`0002_content.sql`):**
- `courses(id pk, organization_id uuid null references organizations, title text not null, description text not null default '', languages text[] not null check (languages <@ array['PYTHON','C','CPP','JAVA'] and cardinality(languages) > 0), status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','ARCHIVED')), content_status text not null default 'REVIEWED' check (content_status in ('REVIEWED','IMPORTED_UNREVIEWED')), created_by uuid references profiles, created_at, updated_at)`
  - `organization_id null` means platform-wide practice owned by the platform owner.
- `questions(id pk, course_id uuid not null references courses on delete cascade, title text not null, statement_md text not null, difficulty text not null check (difficulty in ('EASY','MEDIUM','HARD')), points int not null default 10 check (points between 0 and 1000), topics text[] not null default '{}', time_limit_ms int not null default 2000 check (time_limit_ms between 100 and 20000), memory_limit_mb int not null default 256 check (memory_limit_mb between 16 and 1024), output_limit_kb int not null default 64 check (output_limit_kb between 1 and 1024), starter_code jsonb not null default '{}', order_index int not null default 0, created_at, updated_at)`
- `question_tests(id pk, question_id uuid not null references questions on delete cascade, kind text not null check (kind in ('VISIBLE','HIDDEN')), ordinal int not null, input text not null, expected_output text not null, unique (question_id, kind, ordinal))`
- `class_courses(class_id uuid references classes on delete cascade, course_id uuid references courses on delete cascade, primary key (class_id, course_id))`
- `assessments(id pk, organization_id uuid not null references organizations, course_id uuid not null references courses, class_id uuid not null references classes, title text not null, question_ids uuid[] not null, opens_at timestamptz not null, closes_at timestamptz not null check (closes_at > opens_at), duration_minutes int not null check (duration_minutes between 5 and 600), attempts_allowed int not null default 1 check (attempts_allowed between 1 and 20), grace_period_minutes int not null default 10, high_stakes boolean not null default false, status text not null default 'DRAFT' check (status in ('DRAFT','SCHEDULED','CLOSED')), created_by uuid references profiles, created_at)`
- `assessment_keys(assessment_id uuid primary key references assessments on delete cascade, key_id uuid not null, key_b64 text not null, created_at)`: **no policies at all**, so only `service_role` can read it.
- `course_pack_versions(pack_id text primary key, kind text not null check (kind in ('COURSE','ASSESSMENT')), course_id uuid references courses, assessment_id uuid references assessments, version int not null, object_path text not null, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), size bigint not null, min_app_version text not null, published_by uuid references profiles, published_at default now())`
  - Checks: exactly one of `course_id` and `assessment_id` is set, matching `kind`. `unique (course_id, version)`, `unique (assessment_id, version)`.

**Work (`0003_work.sql`):**
- `submissions(id uuid primary key, user_id uuid not null default auth.uid() references profiles, organization_id uuid references organizations, pack_id text not null, course_id uuid not null references courses, question_id uuid not null references questions, assessment_id uuid null references assessments, language text not null check (language in ('PYTHON','C','CPP','JAVA')), source text not null check (octet_length(source) <= 65536), source_sha256 text not null, verdict text not null, passed int not null, total int not null, total_time_ms int not null, results_json jsonb not null, started_at timestamptz not null, finished_at timestamptz not null, monotonic_seq bigint not null, device_id uuid not null, signature text null, received_at timestamptz not null default now(), late_status text null check (late_status in ('ON_TIME','LATE','FINISHED_OFFLINE_SYNCED_LATE')), recheck_status text not null default 'NOT_REQUIRED' check (recheck_status in ('NOT_REQUIRED','QUEUED','RUNNING','DONE','FAILED')), recheck_verdict text null, recheck_passed int null, recheck_total int null, recheck_at timestamptz null)`
  - Check: `verdict` (and `recheck_verdict`) is in the C1 verdict list.
  - Index on `(user_id, question_id)`, `(assessment_id)` and `(organization_id, received_at)`.
- `feedback(id pk, submission_id uuid not null references submissions on delete cascade, teacher_id uuid not null references profiles, body text not null, score_override numeric null, released boolean not null default false, created_at)`
- `devices(user_id uuid references profiles on delete cascade, device_id uuid, public_key text not null, registered_at default now(), revoked_at timestamptz null, primary key (user_id, device_id))`
- `assessment_key_issues(id pk, assessment_id uuid not null references assessments, user_id uuid not null references profiles, key_id uuid not null, device_id uuid null, issued_at default now())`
- **Trigger `submissions_guard` (BEFORE INSERT, security definer)**:
  - Force `user_id = auth.uid()` (unless the role is `service_role`).
  - Set `organization_id` from the caller's profile, or from the course for platform-wide practice.
  - Force `received_at = now()`, `late_status = null` and the recheck columns to their defaults.
  - Reject the insert when `assessment_id` is set and the question is not in `assessments.question_ids`.
  - Phase 10 adds the late and recheck logic in a later migration; leave `-- TODO(offline-integration): phase 10 late/recheck`.

**KPI (`0004_kpi.sql`; written by ATP through `service_role` only):**
- `kpi_student_daily(organization_id uuid not null, user_id uuid not null, day date not null, active_minutes numeric(8,1) not null, questions_attempted int not null, questions_solved int not null, runs int not null, submits int not null, accepted_submits int not null, typed_chars bigint not null, paste_chars bigint not null, paste_ratio numeric(4,3) not null, focus_lost_count int not null, idle_minutes numeric(8,1) not null, computed_at timestamptz not null, primary key (user_id, day))`
- `kpi_student_topic(organization_id uuid not null, user_id uuid not null, topic text not null, attempted int not null, solved int not null, mastery int not null check (mastery between 0 and 100), computed_at timestamptz not null, primary key (user_id, topic))`
- `kpi_assessment(organization_id uuid not null, assessment_id uuid not null, user_id uuid not null, score numeric not null, solved int not null, total_questions int not null, time_minutes numeric(8,1) not null, flags text[] not null default '{}', computed_at timestamptz not null, primary key (assessment_id, user_id))`
- View `kpi_class_daily` (`security_invoker = true`): `class_id, day, active_students, avg_active_minutes, solve_rate`, joining `class_members` (role `STUDENT`) to `kpi_student_daily`.
  - `active_students` counts rows with `active_minutes > 0`.
  - `solve_rate = round(sum(questions_solved)::numeric / nullif(sum(questions_attempted), 0), 3)`.

### Helper functions (`0005_rls.sql`; `security definer`, `stable`, `set search_path = public, pg_temp`, owned by the migration role, `execute` granted to `authenticated` only)
- `app_role()` and `app_org()`: from the caller's `profiles` row, null when there is none or the status is `DISABLED`.
- `rls_is_class_teacher(class_id)`, `rls_is_class_member(class_id)`.
- `rls_can_read_course(course_id)`: true when any of these holds:
  - the course is platform-wide, `PUBLISHED`, and the caller has an active profile;
  - the caller is in a class linked through `class_courses`;
  - the caller is a teacher of such a class;
  - the caller is `COLLEGE_ADMIN` of the course's org;
  - the caller is `PLATFORM_OWNER`.
- `rls_can_read_pack(pack_id)`: for course packs, `rls_can_read_course`. For assessment packs, the caller is a member of the assessment's class and the assessment status is `SCHEDULED` or `CLOSED`, or the caller is a teacher of that class or a college admin of the org.
- `rls_can_manage_course(course_id)`: the teacher of any class linked to the course, the college admin of its org, or the platform owner for platform-wide courses.

### Policies (write them as a matrix in `supabase/README.md` too)
| Table | STUDENT | TEACHER | COLLEGE_ADMIN | PLATFORM_OWNER |
| --- | --- | --- | --- | --- |
| organizations | own org: select | own org: select | own org: select, update name | all |
| profiles | self: select | self + members of own classes: select | own org: select, insert, update (not role `PLATFORM_OWNER`) | all |
| departments, classes | own classes: select | own classes: select | own org: all | all |
| class_members | own rows: select | own classes: select | own org: all | all |
| courses | `rls_can_read_course` and status `PUBLISHED`: select | read, and `rls_can_manage_course`: insert/update | own org: all | all |
| questions | course readable: select | manage: all | own org: all | all |
| question_tests | **VISIBLE only**, course readable: select | manage: all | own org: all | all |
| class_courses | own classes: select | own classes: insert/delete | own org: all | all |
| assessments | own class, status not `DRAFT`: select | own classes: all | own org: all | all |
| assessment_keys | none | none | none | none |
| course_pack_versions | `rls_can_read_pack`: select | same + insert via the broker only (`service_role`) | select | all |
| submissions | own: select; insert only when `rls_can_read_course(course_id)` (phase 10 further limits this to `assessment_id is null`) | own classes' students: select | own org: select | all |
| feedback | own submissions and `released`: select | own classes: all | own org: select | all |
| devices | own: select, insert | none | own org: select | all |
| assessment_key_issues | own: select | own classes: select | own org: select | all |
| kpi_student_daily / topic | own: select | own classes' students: select | own org: select | all |
| kpi_assessment | own: select | own classes: select | own org: select | all |

- `anon` gets **no** grants on any table.
- Nobody but `service_role` can update or delete `submissions` or write `kpi_*`.

### Scripts
- **`supabase/scripts/bootstrap-owner.mjs`** `--database-url <url> --email <e> --full-name <n>`:
  - Creates the `auth.users` row via the Supabase Admin API when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars are set (`auth.admin.createUser({ email, email_confirm: true })`), or directly in `auth.users` when `--local-stub` is passed (tests only).
  - Then inserts the `PLATFORM_OWNER` profile.
  - Refuses if an owner exists. Refuses domains `example.*`, `*.test`, `*.local` and anything containing `demo`.
  - Never prints keys.

### Tests (`packages/supabase-tests/test/*.test.mjs`, run through `pnpm test:supabase`)
- The helpers `asUser(client, userId, fn)` set `role authenticated` and `request.jwt.claims` inside a transaction. `asService` uses `service_role`.
- **Fixtures are created inside each test file** and removed afterwards: two orgs, departments, classes, a teacher, two students, a college admin and an owner. Nothing is committed as seed data.
- **RLS matrix:** for every table and role in the policy table, assert at least one allowed and one denied operation. In particular:
  - A student never reads a `HIDDEN` `question_tests` row, even for their own course.
  - A student cannot read another student's submission or KPIs.
  - A teacher cannot read another org's data, or a class they do not teach.
  - Nobody but `service_role` can select `assessment_keys`.
  - A student insert into `submissions` with a different `user_id` is overwritten to their own ID.
  - A student cannot update or delete submissions.
  - A student cannot see `DRAFT` assessments.
  - `anon` can read nothing.
- `kpi_class_daily` returns correct sums and respects RLS (a teacher sees only own classes).
- The bootstrap refuses a second owner and the forbidden domains.
- Migrations apply on an empty database, and a second application is detected or refused as Supabase would (each file runs once). Use `create … if not exists` only where Supabase conventions allow; do not make migrations silently idempotent.

### Verification
```
pnpm test:supabase
```
Plus master §7. Also run `pnpm test:integration` to prove the existing API integration suite still passes after the `local-postgres.mjs` change.

**Blocked unless the owner provides a Supabase project:** `supabase db push` to a real project, and an OTP login using Brevo SMTP. Write the exact steps in `supabase/README.md`.

### Must not
- No changes to `apps/api` migrations or schema.
- No seed or demo data in `supabase/migrations`.
- No policy that uses `using (true)` for `authenticated` on a tenant table.
- No `security definer` function without a fixed `search_path`.

### Integration notes to leave
- The final column list, copied into the report: this becomes the frozen C9.
- The exact env vars the scripts need.
- How the desktop and dashboard should read the role (`app_role()` through RPC, or a `profiles` select).

---

# PART 07 — Broker: Supabase Edge Functions

_Source file: `docs/codex/offline-first/07-broker-edge-functions.md`_

Track B. It needs phase 06, and phase 01 (`packages/pack-format`) on the branch. Read `00-MASTER-PROMPT.md` first; contracts C2, C3, C5, C8 and C9 apply.

### Goal
The only server logic in the new design. Small Supabase Edge Functions (Deno) that:
- hand out short-lived Oracle Object Storage URLs (activity upload, pack download)
- build, sign and upload course packs from Supabase data
- invite users

The Oracle API key and the pack-signing key exist only here.

### Read first
- `apps/api/src/integrations/oci.ts`: the existing OCI request signer.
  - It signs only `(request-target) date host`. That is correct for `PutObject`/`GetObject`, but **wrong for POST/PUT requests with a JSON body**, such as CreatePreauthenticatedRequest. Those must also sign `x-content-sha256`, `content-type` and `content-length`.
  - Follow Oracle's "Request Signatures" documentation exactly.
- `packages/pack-format/` and its README (the Deno import notes from the phase 01 report).
- `supabase/migrations/*` and `supabase/README.md` (phase 06).

### Allowed paths
- Create:
  - `supabase/functions/_shared/{oci.js,auth.js,http.js,pack-format.js,errors.js}` and `supabase/functions/_shared/*.test.mjs`.
  - `supabase/functions/{activity-upload-url,pack-download-url,publish-pack,invite-user}/index.ts`.
  - `supabase/functions/deno.json` (import map: `@supabase/supabase-js` → `jsr:@supabase/supabase-js@2`, `fflate` → `npm:fflate@0.8`).
  - `supabase/scripts/import-jbank.mjs`, `supabase/scripts/sync-pack-format.mjs`.
- Modify `packages/supabase-tests/**` (add tests for `import-jbank`), `supabase/README.md` (add a "Broker" section), root `package.json` (script `"check:edge-sync": "node supabase/scripts/sync-pack-format.mjs --check"`).
- Create `docs/codex/offline-first/reports/07-report.md`.

### Design rules
- **Thin entry points:** each `index.ts` only parses the request, calls a pure handler from `_shared` (plain ESM `.js` with JSDoc, so `node --test` can test it without Deno), and returns the response. Handlers receive their dependencies injected (`{ db, oci, signer, now, env }`).
- **`_shared/pack-format.js`** is a **generated copy** of `packages/pack-format/index.js`, rewritten for Deno (bare `fflate` import resolved by the import map). It is made by `sync-pack-format.mjs`. `--check` fails if the copy is stale, and is part of the master §7 checks from now on. Never edit the copy by hand.
- **Auth (`auth.js`):**
  - Read `Authorization: Bearer <jwt>` and create a per-request supabase-js client with that header, so **RLS decides what the user can read**.
  - Use a separate service-role client only for writes RLS forbids (pack versions, uploads, invites), and only **after** an explicit permission check done through the user client.
  - A missing or invalid JWT gives 401.
- **Errors (`errors.js`):** `{ error: CODE, message }` with the C8 status codes. Never include stack traces, SQL or keys.
- **CORS:** allow only the origins in env `ALLOWED_ORIGINS` (comma-separated: the dashboard domain, plus `tauri://localhost` and `http://tauri.localhost` for the desktop). Answer `OPTIONS` preflight.
- **Limits:** request body ≤ 64 KB, except that `publish-pack` reads from the DB, not the body.

### Tasks
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

### Tests (`node --test supabase/functions/_shared/*.test.mjs`; add them to the root `pnpm test` through a small package or script, and say which)
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

### Verification
```
node --test supabase/functions/_shared
pnpm check:edge-sync
pnpm test:supabase
```
Plus master §7.

**Blocked without owner credentials:** deploying the functions and one real PAR round trip (upload a 1 KB gzip, download a pack). Write the manual steps in the README.

### Must not
- No service-role reads in place of RLS checks for user-facing reads.
- No keys in code, tests, fixtures or logs. Tests generate their own keys.
- No public bucket. No PAR longer than 15 minutes, except the owner-created language-pack prefix PAR, which this phase does not create.

### Integration notes to leave
- The function URLs and request examples for the desktop (phase 05) and dashboard (phase 09).
- The exact env and secret names.
- Any OCI quirk found.

---

# PART 08 — KPI calculation: reference calculator and the Oracle ATP pipeline

_Source file: `docs/codex/offline-first/08-atp-kpi-pipeline.md`_

Track B. It needs phase 06 (KPI tables). It does not need phases 05 or 07 to be finished. Read `00-MASTER-PROMPT.md` first; contracts C3, C9, C10 and C11 apply.

### Goal
Each night, Oracle ATP:
1. loads new raw activity files from Object Storage
2. pulls question and assessment metadata from Supabase
3. calculates the C11 KPIs for every affected student
4. pushes the results into the Supabase `kpi_*` tables

A JavaScript reference calculator defines the exact numbers and is the test oracle for the SQL. The SQL must give **identical** results on the same fixtures.

### Read first
- Master C10 (event format) and C11 (formulas): these are the specification.
- `supabase/migrations/*0004_kpi.sql` (phase 06): the target tables and their keys.
- Oracle documentation (current version for Autonomous Database Serverless):
  - `DBMS_CLOUD.CREATE_CREDENTIAL`, `LIST_OBJECTS`, `COPY_DATA` / `CREATE_EXTERNAL_TABLE` with JSON format and gzip compression
  - `DBMS_CLOUD.SEND_REQUEST`
  - `DBMS_NETWORK_ACL_ADMIN`
  - `DBMS_SCHEDULER`
  - `JSON_TABLE`
  
  Cite the doc page title in comments wherever you rely on a specific option.

### Allowed paths
- Create `packages/kpi-calc/**` (plain ESM + `.d.ts`, `node --test`, no runtime dependencies).
- Create `oracle/atp/sql/{001_setup_admin.sql,002_tables.sql,003_ingest.sql,004_dimensions.sql,005_kpi.sql,006_publish.sql,007_scheduler.sql}`.
- Create `oracle/atp/{README.md,verify.mjs,keepalive.mjs}`, `oracle/atp/package.json` (dependency `oracledb` 6, thin mode only; scripts `verify` and `keepalive`), and `oracle/atp/fixtures/**`.
- Create `.github/workflows/atp-keepalive.yml`.
- Modify `pnpm-workspace.yaml`, **only** to add `oracle/atp`. Say so in the report.
- Create `docs/codex/offline-first/reports/08-report.md`.

### Tasks
1. **`packages/kpi-calc`**, pure functions with no I/O:
   - `normaliseEvents(events)`: drops duplicate `eventId`s (keeps the first by `seq`) and invalid events (missing `userId`, `clientTs` or `eventType`). Returns the events sorted by `userId`, then `seq`.
   - `computeStudentDaily(events, { computedAt })` → `kpi_student_daily` rows (snake_case keys exactly as the table).
   - `computeStudentTopic(events, questionMeta, { computedAt })` → `kpi_student_topic` rows. `questionMeta` is `Map<questionId, { topics: string[], points: number }>`. Questions missing from the map are ignored, and their count is reported in a second return value `{ rows, skippedQuestions }`.
   - `computeAssessment(events, assessments, questionMeta, { computedAt })` → `kpi_assessment` rows. `assessments` is `Map<assessmentId, { organizationId, questionIds }>`.
   - Implement C11 exactly, including:
     - the 120 s gap cap
     - idle exclusion: a gap is zero when an `idle_period` event lies between the two events, or is the second event
     - rounding: half away from zero, done once at the end, never on intermediate values
     - UTC day grouping
     - `FAST_SOLVE` and the other flag rules
   - Write a `FORMULAS.md` restating each formula, with a worked example taken from a fixture.
2. **Fixtures (`oracle/atp/fixtures/`):**
   - `events-*.jsonl`, C10 lines written by hand; at least 6 files covering:
     - one normal student day
     - a day crossing midnight UTC
     - duplicate event IDs
     - idle periods
     - external and editor pastes
     - an assessment with the `HIGH_PASTE`, `FAST_SOLVE` and `MANY_FOCUS_LOSS` triggers
     - a question missing from the metadata
     - two orgs
   - `questions.json` and `assessments.json`: metadata.
   - `expected-*.json`: the expected rows. **Calculate them by hand** and show the arithmetic in `FORMULAS.md`, at least for the normal-day and assessment cases. Then confirm that `kpi-calc` matches them. Do not generate expected files from the code under test.
   - Fixtures are synthetic. Use obviously fake UUIDs (`00000000-0000-4000-8000-0000000000xx`). They are never loaded into a real tenant.
3. **ATP SQL** (Oracle 23ai; run as the schema user `LPKPI`, except `001`, which runs as `ADMIN`):
   - **`001_setup_admin.sql`**, a template with `&` substitution variables and **no secret values**:
     - Create user `LPKPI` with only the quota and grants it needs (`DBMS_CLOUD`, `DBMS_SCHEDULER` create job).
     - Network ACL: HTTPS to the Supabase host only.
     - `DBMS_CLOUD.CREATE_CREDENTIAL('LP_OCI_CRED', …)` using an OCI API key, or a resource principal if available (document both).
   - **`002_tables.sql`:**
     - `lp_ingested_files(object_name pk, etag, loaded_at, row_count)`
     - `lp_stg_activity(event_id pk, seq, event_type, client_ts timestamp with time zone, user_id, organization_id, device_id, pack_id, question_id, assessment_id, attempt_id, language, metadata json, object_name, loaded_at)`
     - `lp_dim_question(question_id pk, topics json, points)`
     - `lp_dim_assessment(assessment_id pk, organization_id, question_ids json)`
     - result tables mirroring the three Supabase `kpi_*` tables, plus `published_at` and `changed_at`
     - `lp_runs(run_id, started_at, finished_at, status, files_loaded, events_loaded, rows_published, error_text)`
     - `lp_secrets(name pk, value)`, which **the owner fills by hand** with the Supabase service key. There are no grants on it, and only the publish package reads it. Document how to use OCI Vault instead, with `TODO(offline-integration)`.
   - **`003_ingest.sql`, package `lp_ingest`:**
     - `load_new_files(p_prefix default 'raw/activity/')` lists objects, skips files already in `lp_ingested_files`, and loads each new gzip JSONL into staging. Use `COPY_DATA` or an external table with JSON format and `compression 'gzip'`, and say in a comment which one and why.
     - Duplicate `event_id`s are ignored (merge).
     - Each file is committed separately, so one bad file does not block the others. A bad file is recorded in `lp_runs.error_text` and skipped. It is not marked ingested, so it is retried next night.
   - **`004_dimensions.sql`, package `lp_dims`:** `refresh()` fetches `questions?select=id,topics,points` and `assessments?select=id,organization_id,question_ids` from Supabase PostgREST with `SEND_REQUEST` (paged with `Range` headers, 1,000 rows per page) and merges them into the dimension tables.
   - **`005_kpi.sql`, package `lp_kpi`:** `compute_changed(p_since timestamp)` recomputes **only** the users and days touched by events loaded since `p_since`.
     - It deletes and reinserts those rows in the result tables, setting `changed_at`.
     - The formulas follow C11 and the reference calculator line by line. Use window functions (`LAG` over `seq`) for gaps.
     - Topic and assessment KPIs are recomputed for every affected user over all time.
   - **`006_publish.sql`, package `lp_publish`:** `push_changed()` sends rows where `changed_at > published_at` (or `published_at` is null) to Supabase.
     - Use `POST /rest/v1/<table>?on_conflict=<pk columns>` with `Prefer: resolution=merge-duplicates,return=minimal`, in batches of 500 rows built with `JSON_ARRAYAGG`.
     - Headers are `apikey` and `Authorization: Bearer` with the key from `lp_secrets`.
     - On HTTP 2xx, set `published_at`. On any other status, stop, record the status and the first 500 characters of the body (with the key removed) in `lp_runs`, and leave the rows for the next run.
   - **`007_scheduler.sql`:** job `LP_NIGHTLY` daily at 01:30 `Asia/Kolkata` runs `lp_ingest.load_new_files` → `lp_dims.refresh` → `lp_kpi.compute_changed(last successful run start)` → `lp_publish.push_changed`, recording `lp_runs`. Also a procedure `lp_run_now` for manual runs.
4. **`oracle/atp/verify.mjs`** (needs owner credentials; skips with exit code 0 and a clear "SKIPPED: set ATP_* env" message otherwise):
   - Connects with `oracledb` thin mode using `ATP_USER`, `ATP_PASSWORD` and `ATP_CONNECT_STRING` (TLS, walletless).
   - Inserts the fixtures directly into `lp_stg_activity` and the dimension tables of a **separate verification schema**, `LPKPI_VERIFY`, created by the README's steps. It must never touch `LPKPI`.
   - Runs `lp_kpi.compute_changed`, reads the result tables and compares them field by field with `kpi-calc` output for the same fixtures. Exit 1 on any difference, printing a diff.
5. **Keep-alive:**
   - `oracle/atp/keepalive.mjs` runs `select 1 from dual` with the same env vars.
   - `.github/workflows/atp-keepalive.yml` runs it daily (cron `17 3 * * *`) plus `workflow_dispatch`, with secrets `ATP_USER`, `ATP_PASSWORD` and `ATP_CONNECT_STRING`.
   - The workflow does nothing else and prints no secrets.
   - In the README, note that Oracle's idle rule must be confirmed after 8 days of real use (**Blocked** until then).
6. **README:**
   - Order of setup.
   - Exactly what the owner must create in the Oracle console: credential, ACL, schema users, `lp_secrets` row, scheduler.
   - How to run a manual backfill (`lp_run_now`).
   - How to read `lp_runs`.
   - The `pg_cron` fallback: it is the same formulas as `kpi-calc`, written in Supabase SQL. Spec only; do not implement it in this phase.

### Tests
- `pnpm --filter @lplatform/kpi-calc test`:
  - Every fixture equals its expected file.
  - Property tests:
    - Shuffling the event order gives identical output (because of the sort).
    - Duplicating every event gives identical output.
    - `paste_ratio` is in [0, 1].
    - `mastery` is in [0, 100].
    - `active_minutes` ≤ the span of the day.
  - Rounding edge cases: 0.05 rounds to 0.1; 0.0005 to 0.001.
- **SQL static checks (no ATP needed), as a node test in `packages/kpi-calc` or `oracle/atp`:**
  - Every SQL file parses as a list of statements split on `/` and `;` with your simple splitter.
  - No literal key, password or `eyJ` (JWT) text appears.
  - Every `SEND_REQUEST` uses `lp_secrets`.
  - Table and column names used in `006_publish.sql` match the phase 06 migration (parse both files and compare the column lists).
- `oracle/atp/verify.mjs`: **Blocked** until the owner provides ATP access. When it runs, all fixtures must match.

### Verification
```
pnpm --filter @lplatform/kpi-calc test
node oracle/atp/verify.mjs        # prints SKIPPED without ATP_* env
```
Plus master §7.

### Must not
- No secrets in SQL, fixtures, the workflow or logs.
- No writes to Supabase tables other than the three `kpi_*` tables.
- No reading of submission source code. ATP works only from activity events and metadata.
- No production data in fixtures.

### Integration notes to leave
- The owner checklist with the exact order.
- Which `DBMS_CLOUD` load method you chose.
- Measured run time for the fixtures, if ATP was available.
- Anything in C11 that was ambiguous, and how you resolved it. Claude reviews these.

---

# PART 09 — Static dashboards for GitHub Pages

_Source file: `docs/codex/offline-first/09-dashboards-github-pages.md`_

Track B, last phase. It needs phase 06, and uses the phase 07 function contracts (C8); it can mock them. Read `00-MASTER-PROMPT.md` first; contracts C1, C8, C9 and C11 apply.

### Goal
A static single-page web app, deployable to GitHub Pages or Cloudflare Pages, that talks **directly to Supabase** with the public anon key and the user's session. All access control is in RLS.

| Role | What they can do |
| --- | --- |
| Student | See their progress, topics, submissions and released feedback |
| Teacher | Manage course content and tests, link courses to classes, publish packs, create draft assessments, review student code and KPIs, give feedback |
| College admin | Manage departments, classes and members, and invite users |
| Platform owner | Manage organizations and invite college admins |

### Read first
- `supabase/migrations/*`, `supabase/README.md` (phase 06): the policy matrix.
- The phase 07 report: the function URLs and bodies.
- `apps/web/src/components/shared/insights.tsx`, `department-dashboard.tsx`: the existing KPI layouts to take ideas from. **Do not import from `apps/web`.**
- `apps/web/src/app/globals.css` (or the Tailwind theme): the brand colours and spacing, to match the look.

### Allowed paths
- Create `apps/dashboard/**` (package `@lplatform/dashboard`, Vite + React 19 + TypeScript strict).
  - Dependencies: `@supabase/supabase-js` 2, `react-router-dom` 7 (**HashRouter** only), `recharts` 2, `@lplatform/language-config`.
  - Dev dependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@playwright/test`, at the versions already used in the repo where they exist.
- Create `.github/workflows/dashboard-pages.yml`.
- Modify `pnpm-lock.yaml`.
- Create `docs/codex/offline-first/reports/09-report.md`.

### Tasks
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

### Tests
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

### Verification
```
pnpm --filter @lplatform/dashboard test
pnpm --filter @lplatform/dashboard build
pnpm --filter @lplatform/dashboard exec playwright test
```
Plus master §7.

### Must not
- No server-side code, no Next.js, and no middleware: this is a static site.
- No service key or OCI value in the client.
- No fake numbers in production screens.
- Do not modify `apps/web`.

### Integration notes to leave
- The required env and repository variables.
- Which screens call which `DataSource` methods.
- What is waiting for phase 10 (assessment scheduling, high-stakes results).

---

# PART 10 — Assessments, encrypted hidden tests, signed attempts, late rules and re-check

_Source file: `docs/codex/offline-first/10-assessments-trust-recheck.md`_

Final build phase. It needs **all** phases 01–09 on `offline-first`. Read `00-MASTER-PROMPT.md` first; every contract applies, especially C2, C5, C6, C7, C8 and C9, and design §8.

### Goal
A teacher schedules an assessment. Students download it in advance, start it at the opening time (online once, to get the key), and solve it offline. Their results reach the teacher with honest labels:
- on time / late / finished offline but synced late
- the attempts limit enforced
- device signatures verified
- high-stakes submissions re-checked by a central Judge0 worker before they count

### Read first
- Design §8 and all phase reports.
- `apps/api/src/modules/judge/{judge0.provider.ts,provider.ts,worker.ts}`: the Judge0 provider to reuse for the re-check.
- `supabase/functions/*` (phase 07), `apps/dashboard` assessment screens (phase 09), `src-tauri/src/{packs,attempts,device}` (phases 04–05).

### Allowed paths
- Create `supabase/migrations/20261124000006_assessments.sql` (a new migration only; never edit earlier ones).
- Create `supabase/functions/{assessment-key,register-device,submit-assessment-attempts}/index.ts`, plus handlers and tests in `supabase/functions/_shared/`.
- Modify `supabase/functions/publish-pack` and its handler (the assessment path).
- Modify `packages/supabase-tests/**` (new tests).
- Modify the desktop:
  - `apps/student-desktop/src-tauri/src/{packs/*,attempts.rs,lib.rs}`, plus new `src-tauri/src/assessment.rs`.
  - `apps/student-desktop/src/platform/*`, plus new `src/platform/AssessmentView.tsx`.
  - `src/lib/offline-sync.ts`, `src/lib/packs.ts`.
- Modify `apps/dashboard/src/**` (enable scheduling; results screen).
- Create `apps/api/src/modules/judge/recheck-worker.ts` and `apps/api/src/tests/unit/recheck-worker.test.ts`. Add the script `"recheck:worker"` to `apps/api/package.json`. Change nothing else in `apps/api`.
- Modify `supabase/README.md`, `docs/codex/offline-first/00-MASTER-PROMPT.md` (**only** C8/C9 rows marked `ADDED BY PHASE 10`).
- Create `docs/codex/offline-first/reports/10-report.md`.

### Tasks
1. **Migration `…0006_assessments.sql`:**
   - **RLS change:** students may insert `submissions` only when `assessment_id is null`. Assessment submissions arrive only through `submit-assessment-attempts` (service role). Update the policy; do not weaken any other.
   - **View `assessment_results`** (`security_invoker = true`): one row per user and assessment question with the **final verdict**, which is `recheck_verdict` when the assessment is `high_stakes` and the re-check is `DONE`, otherwise `verdict`. It also carries `late_status`, `recheck_status`, the attempt count, the best attempt and the points earned.
     - Per-user totals: score (final `ACCEPTED` points, counting `LATE` rows at 0 unless the teacher overrides through `feedback.score_override`), solved, and pending re-checks.
   - Index `submissions (assessment_id, user_id, question_id)`.
2. **`publish-pack` assessment path:**
   - The caller must be a teacher of the assessment's class, or a college admin. The assessment must be `DRAFT`, all its questions must belong to its course, and `opens_at` must be in the future.
   - Generate a random 32-byte key and a `keyId`, and store them in `assessment_keys`.
   - Build an `ASSESSMENT` pack with encrypted hidden tests (phase 01 `encryption`) and the C5 `assessment` block (`keyId`, window, duration, attempts, grace, `highStakes`).
   - Sign it, upload it to `packs/assessment/{assessmentId}/{version}.lpack`, insert `course_pack_versions` and set the status to `SCHEDULED`.
   - Republishing a `SCHEDULED` assessment before `opens_at` makes a new version **with the same key**. After `opens_at`, republishing gives 409 `ASSESSMENT_STARTED`.
3. **`register-device`** (C8): inserts or updates `devices` for the caller. It refuses to change the public key of an existing non-revoked device (409 `DEVICE_KEY_MISMATCH`), so a stolen session cannot replace a device key silently. Called by the desktop after login.
4. **`assessment-key`** (C8):
   - The caller must be a `STUDENT` member of the assessment's class, with status `SCHEDULED`, and `now()` between `opens_at` and `closes_at`. Otherwise 403 `ASSESSMENT_NOT_OPEN`, or 403 `ASSESSMENT_CLOSED`.
   - Record `assessment_key_issues` (with `device_id` from the body, which must be a registered device).
   - Return `{ keyId, keyB64, closesAt }`.
5. **`submit-assessment-attempts`** (`ADDED BY PHASE 10` to C8). Body `{ attempts: [ <attempt row C7 shape + source> ] }`, at most 20 per call. For each attempt:
   1. The device must be registered for the caller and not revoked.
   2. Verify the Ed25519 signature over the phase 05 canonical JSON; on failure reject with `SIGNATURE_INVALID`.
   3. Check `source_sha256` against the source.
   4. Check that the question belongs to the assessment.
   5. Attempts limit: `SUBMIT` count per user, assessment and question ≤ `attempts_allowed`; otherwise reject with `ATTEMPTS_EXCEEDED`.
   6. **Late rule:** let `issued` be the first key issue time for this user.
      - `ON_TIME` when server `now() ≤ closes_at + grace`.
      - `FINISHED_OFFLINE_SYNCED_LATE` when the server time is later, but `finished_at ≤ closes_at`, `started_at ≥ issued`, `finished_at - started_at ≤ duration_minutes`, and the attempt's `monotonic_seq` is greater than every `monotonic_seq` the server has already received from that device before `issued`.
      - Otherwise `LATE`.
   7. `recheck_status = 'QUEUED'` when `high_stakes`, else `NOT_REQUIRED`.
   8. Insert with the service client, `on conflict (id) do nothing` (idempotent).
   - Response: `{ accepted: [ids], duplicates: [ids], rejected: [{ id, error }] }`. A rejected attempt is never inserted.
6. **Desktop:**
   - **`assessment.rs`:**
     - `assessment_store_key(assessmentId, keyId, keyB64)` stores the key in `SecretStore` under `lplatform/assessment/{assessmentId}`.
     - `run_question` `SUBMIT` on an `ASSESSMENT` pack:
       - Load the key (no key gives `ASSESSMENT_LOCKED`), decrypt the hidden tests **in Rust memory only**, run, and drop the plaintext.
       - Enforce `attemptsAllowed` locally (`ATTEMPTS_EXCEEDED`), and the duration from the first `question_opened` of that assessment.
       - The local clock past `closesAt + grace` gives `ASSESSMENT_CLOSED`. This is user experience only; the server decides lateness.
   - **`AssessmentView.tsx`:**
     - A list of the student's assessments (Supabase `assessments`, RLS), with a **Download** button available as soon as the pack exists.
     - At opening time, a **Start** button fetches the key; this needs to be online once. With no network, show the message "Connect once at the start time to unlock".
     - Then the timer, the question list (using `OfflineQuestionWorkspace`), and attempts left.
     - After submission: "Saved on this computer — will upload when online", then "Uploaded".
   - **`offline-sync.ts`:** attempts with `assessment_id` go to `submit-assessment-attempts` instead of the direct upsert. `rejected` items are parked with their error and shown to the student.
   - After login, call `register-device` once per device.
7. **Re-check worker (`apps/api/src/modules/judge/recheck-worker.ts`):**
   - A separate process (`pnpm --filter @lplatform/api recheck:worker`), configured by `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JUDGE0_URL` and `JUDGE0_AUTH_TOKEN`.
   - It refuses to start unless `JUDGE_PROVIDER=judge0`. **Never** use `local-unsandboxed-dev` here.
   - It claims `QUEUED` rows (`update … set recheck_status='RUNNING' where id = (select id … for update skip locked limit 1) returning *`, through an RPC function you add in the 0006 migration, `claim_recheck()`, `security definer`, granted to `service_role` only).
   - It loads all tests from `question_tests`, runs them through the existing `Judge0Provider`, and writes `recheck_verdict`, `recheck_passed`, `recheck_total`, `recheck_at` and `DONE`.
   - On Judge0 failure it sets `FAILED` after 3 tries with backoff, and never marks a pass.
   - It logs no source code and no test data.
8. **Dashboard:**
   - **Schedule** calls `publish-pack { assessmentId }`.
   - The results screen reads `assessment_results` plus the `kpi_assessment` flags, and shows the late label, re-check status (Pending / Checked / Failed), final verdict, attempts used, and score with override.
   - A teacher can set `feedback.score_override` and release.
   - The student view shows their own final results only after the assessment closes.

### Tests
- **`packages/supabase-tests`:**
  - The direct student insert with `assessment_id` is now denied; a practice insert still works.
  - `assessment_results` final-verdict logic (high-stakes with recheck `DONE`/`QUEUED`, and normal), with RLS.
  - `claim_recheck` is callable only by `service_role`, and two concurrent claims never return the same row.
- **Edge handler tests (node):**
  - **publish assessment:** the pack has `.hidden.enc` and no plain hidden tests; `readPack` returns `hidden: null`; decrypting with the stored key gives the original tests; republish before open keeps the key; after open gives 409.
  - **assessment-key:** before open 403; after close 403; non-member 403; valid gives the key and records an issue row; an unregistered device gives 403.
  - **register-device:** a key change gives 409.
  - **submit-assessment-attempts:**
    - A bad signature is rejected; a tampered source hash is rejected.
    - The attempts limit holds.
    - Each late rule branch gives the expected label (inject `now`).
    - A duplicate is reported in `duplicates`.
    - High-stakes gives `QUEUED`.
    - Max 20 per call gives 413.
- **Rust:** an assessment `SUBMIT` with no key gives `ASSESSMENT_LOCKED`; with the key it decrypts and runs; a wrong key gives `DECRYPT_FAILED`, mapped to `ASSESSMENT_LOCKED`; the attempts limit holds; no plaintext hidden-test file is ever written to disk (assert the temp dirs contain no marker string).
- **TS:** assessment attempts are routed to the function; rejected ones are parked; the offline Start message.
- **Re-check worker unit tests,** with a mocked Supabase and a mocked Judge0 provider: a correct claim → run → update; failure → `FAILED` after 3 tries; refusal without `JUDGE_PROVIDER=judge0`.
- **Dashboard tests:** Schedule enabled; the results screen labels.
- **Blocked without hardware:** a re-check against real Judge0 (needs the college x86 Linux PC from the design). Use `infra/judge/production/README.md` for that machine.

### Verification
```
pnpm test:supabase
node --test supabase/functions/_shared
cargo +stable test --manifest-path apps/student-desktop/Cargo.toml
pnpm --filter @lplatform/student-desktop test
pnpm --filter @lplatform/dashboard test
pnpm --filter @lplatform/api test
```
Plus master §7.

### Must not
- No decrypted hidden tests outside Rust memory. No key in SQLite or logs.
- No path for students to insert assessment submissions directly.
- The re-check worker must never mark `ACCEPTED` without a real Judge0 result.
- Do not edit earlier migrations.

### Integration notes to leave
- The full assessment journey as a numbered list, for Claude's end-to-end test.
- Every `TODO(offline-integration)` left anywhere in the code base (`rg "TODO\(offline-integration\)"` output).
- The final list of contract additions.
