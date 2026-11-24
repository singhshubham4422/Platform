# 12 — Offline-first architecture (proposed)

Status: **Proposed, 2026-11-24. Nothing in this document is implemented yet** unless it is marked "exists".
It changes the direction set in `02-target-architecture.md` and `08-coding-judge-architecture.md`. Before, the server checked every submission with Judge0. Now the student's machine does the work, and the cloud only stores, calculates and shows results.

## 1. Product goal

The product is an offline-first mix of HackerRank (coding practice and tests), LeetCode (problem sets with instant verdicts) and Google Classroom (courses, assignments, teacher dashboards).

- A student installs the desktop app once, signs in once and downloads what they need.
- After that they can study, write code, run tests and take assessments **without internet**.
- When the machine is online, results and activity sync. Dashboards on the web show calculated performance to students and teachers.

## 2. Walkthrough

1. The student installs the desktop app (MSI or NSIS from GitHub Releases) and signs in with an email code.
2. The **Platform** view lists courses, for example "DSA".
3. They open DSA and choose a language, for example Java.
4. If the Java **language pack** isn't installed, the app downloads it from Oracle Object Storage, verifies it and unpacks it into the app's own data folder. Nothing is installed on the operating system and no PATH changes.
5. The app downloads the DSA **course pack**: questions, starter code and test cases.
6. Offline from here on: the student opens a question, writes code in Monaco and presses Run or Submit.
7. The local runner compiles and runs the code against the pack's tests. It shows a verdict per test: Accepted, Wrong Answer, Compile Error, Runtime Error, Time Limit or Memory Limit.
8. Results, code and activity (KPIs) are saved in the local SQLite database.
9. When online, the app syncs: raw activity goes to Oracle Object Storage, and results and code go to Supabase.
10. Each night Oracle ATP loads the raw activity, calculates KPIs and writes the calculated tables to Supabase.
11. GitHub Pages dashboards read those tables from Supabase and show them to the student.
12. Teachers follow the same pattern. They create an assessment, it is published as a pack, students attempt it offline and sync, ATP calculates, and the teacher dashboard shows the results.

## 3. Components and where they run

```
┌──────────────── Oracle Object Storage (Always Free, 20 GB) ───────────────┐
│ packs/lang/{lang}/{version}/{os}-{arch}.zip  + .sig       (language packs)│
│ packs/course/{courseId}/{version}.lpack      + .sig       (course packs)  │
│ raw/activity/{org}/{yyyy}/{mm}/{dd}/{batchId}.jsonl.gz    (raw uploads)   │
│ backups/postgres/{yyyy-mm-dd}.dump.gz                     (nightly)       │
└────────▲──────────────────────────────┬───────────────────────────────────┘
         │ upload via short-lived URL   │ DBMS_CLOUD reads raw/ nightly
         │                              ▼
┌──── Student PC: desktop app ────┐   ┌──── Oracle ATP (Always Free) ──────┐
│ Tauri + React + Monaco           │   │ staging tables ← raw JSONL         │
│ language pack manager (new)      │   │ KPI jobs (DBMS_SCHEDULER)          │
│ local runner (new)               │   │ full KPI history                   │
│ SQLite: drafts, outbox, results  │   │ pushes calculated rows → Supabase  │
│   activity, packs (exists)       │   └────────────────┬───────────────────┘
└──────┬───────────────────────────┘                    │ HTTPS (PostgREST)
       │ results, code, sync                            ▼
       │                              ┌──── Supabase (Postgres + Auth) ────┐
       └─────────────────────────────►│ users, orgs, courses, assessments  │
                                      │ attempts, submissions (code)       │
┌──── Login + upload broker ───────┐  │ kpi_* tables (read-only for users) │
│ Supabase Edge Function or        │  └────────────────▲───────────────────┘
│ Oracle micro #1 (existing API)   │                   │ supabase-js + RLS
│ issues upload URLs, signs packs  │  ┌──── GitHub Pages (static) ─────────┐
└──────────────────────────────────┘  │ student dashboard, teacher dashboard│
                                      └─────────────────────────────────────┘
Optional: college Linux PC with Judge0 + worker, to re-check graded attempts (§8).
```

| Component | Hosting | Cost |
| --- | --- | --- |
| Desktop app | Student PC; installers on GitHub Releases | Free |
| Language and course packs | Oracle Object Storage | Free (20 GB, about 50k requests/month) |
| Raw activity, backups | Oracle Object Storage | Free |
| KPI calculation and history | Oracle ATP Always Free (1 OCPU, 20 GB) | Free |
| Operational data, login, serving tables | Supabase Free (500 MB) | Free, Pro ($25/month) if it outgrows the free plan |
| Upload and login broker | Supabase Edge Function or Oracle micro #1 | Free |
| Dashboards | GitHub Pages (separate public repo, no secrets) | Free |
| Email codes and invitations | Brevo SMTP (about 300/day) | Free |
| Domain | Any registrar, DNS at Cloudflare | About ₹1,000/year (required: email SPF/DKIM, cookies) |
| Optional graded re-check | College-owned x86 Linux PC running Judge0 | Free if the hardware exists |

## 4. Language packs

**Contents, per OS and architecture:**
- **Java:** Eclipse Temurin JDK reduced with `jlink` (`java.base`, `jdk.compiler`, `java.logging`), about 60–80 MB.
- **Python:** the official embeddable distribution (Windows) or python-build-standalone (macOS/Linux), about 15–25 MB.
- **C/C++:** WinLibs MinGW-w64 GCC on Windows, about 150 MB. On macOS/Linux, a bundled toolchain, or the system compiler if one is detected (decision D6).

**Layout:**
```
packs/lang/java/21.0.5/windows-x86_64.zip
packs/lang/java/21.0.5/windows-x86_64.zip.sig
packs/lang/index.json        # signed list of {lang, version, os, arch, size, sha256, url, entry points}
```

**Index entry:**
```json
{ "lang": "java", "version": "21.0.5", "os": "windows", "arch": "x86_64",
  "size": 71234567, "sha256": "…", "path": "packs/lang/java/21.0.5/windows-x86_64.zip",
  "compile": ["bin/javac", "-encoding", "UTF-8", "-d", "{out}", "{src}"],
  "run": ["bin/java", "-Xmx{memMb}m", "-cp", "{out}", "{main}"] }
```

**Install flow, in the Rust side of the desktop app:**
1. Fetch `index.json` and verify its Ed25519 signature against a public key compiled into the app.
2. Download the zip to a temporary file. The download must resume after interruption, because student networks are unreliable.
3. Check the SHA-256 against the index, then unpack to `{app_data}/runtimes/{lang}/{version}/`.
4. Run a smoke test (compile and run Hello World). Only then mark the pack installed in SQLite.
5. Keep at most two versions per language and delete older ones after a successful upgrade.

**Rules:**
- Never write outside the app data folder. Never change PATH. Never ask for admin rights.
- Ship each toolchain's licence text inside its pack, and list it in `THIRD_PARTY_NOTICES`.
- Packs are signed by a release key held offline, never on any server. The broker can only hand out download links to files that are already signed.

## 5. Course packs

A course pack is one file (`.lpack`, a zip) per course version, or per assessment.

```
manifest.json     # courseId, version, minAppVersion, orgId, languages, question list, sha256 per file
questions/{id}.json    # statement (Markdown), limits, starter code per language, visible tests
tests/{id}.bin         # hidden tests, encrypted (see §8)
assets/…               # images, PDFs referenced by statements
```

- The existing `course_packages` table and the desktop course cache (`store_put_course`, `store_list_courses`) are the starting point. The manifest format above replaces the current free-form `manifest` jsonb.
- Packs are immutable. Changing a course publishes a new version, and the app downloads only the changed files, matched by hash.
- Assessment packs carry `opensAt`, `closesAt`, `durationMinutes` and `attemptsAllowed`. The app enforces them locally; the server re-checks them on sync (§8).
- The 240 imported Java questions in `content/j-platform-question-bank/` become the first practice pack.

## 6. Local runner

The runner lives in Rust, in the Tauri backend, and is exposed as a `run_code` command. It replaces Judge0 for everyday use.

**For each test case:**
1. Write the source to a per-run temporary folder inside app data.
2. Compile, if the language needs it, with a time limit (10 s) and output limit.
3. Run with the question's limits:
   - **Windows:** a Job Object with a memory limit, a CPU time limit and a cap on active processes (to stop fork bombs). Close the job when the run finishes.
   - **macOS/Linux:** `setrlimit` (CPU, address space, process count, file size), run in a new process group, kill the group on timeout.
4. Send stdin, capture stdout and stderr with a size cap (for example 64 KB), and record wall time and peak memory.
5. Compare output with `outputsMatch` from `packages/language-config`, the same normalisation the server used.
6. Delete the temporary folder.

**Rules:**
- Never run with a shell (no `cmd /c`, no `sh -c`). Pass arguments as an array.
- Keep the environment minimal: no inherited secrets or session tokens.
- Network access from student code is not blocked on Windows in v1. This is acceptable because it is the student's own machine and own code (see §8 for graded work).
- Verdict names stay the existing `VERDICTS` list, so dashboards and the old server data agree.

## 7. Local data and sync

**Already exists** in `src-tauri/src/store.rs`: drafts, an outbox with retries, notes, course cache and sync cursors. New tables:

| Table | Contents |
| --- | --- |
| `runtimes` | Installed language packs: lang, version, path, installed_at |
| `packs` | Downloaded course and assessment packs: id, version, sha256, path |
| `attempts` | One row per Run or Submit: question, language, code hash, verdict per test, time, memory, started/finished, local clock and monotonic counter |
| `activity` | KPI events: keystroke bursts, paste size, focus lost/regained, run count, idle periods, time per question. Kept in batches, not one row per keystroke. |

**Sync order** (resumable, one operation at a time, idempotent IDs as in `09-offline-sync-design.md`):
1. Refresh the session.
2. Upload submissions and attempts to Supabase. Code is stored there because teachers review it.
3. Ask the broker for short-lived upload URLs, then upload activity batches as `jsonl.gz` to `raw/activity/…`. One file per batch, at most one batch per minute of activity, so the request count stays well under the 50k/month limit.
4. Download new or changed packs, results and teacher feedback.
5. Delete uploaded local activity only after the server confirms it.

**Clock trust:**
- Every record carries both the local clock time and a monotonic counter kept since install.
- The server records when it received each record.
- Lateness for assessments is decided by the server from these, not by the PC clock alone (§8).

## 8. Trust model for graded work

To grade offline, the hidden tests have to be on the student's PC. **Encryption only slows down a determined student; it does not stop them.** The design therefore separates practice from graded work.

| Mode | Where it is judged | Trust |
| --- | --- | --- |
| Practice | Local runner only | Fully local. Cheating only hurts the student. |
| Graded, low stakes | Local runner, result accepted on sync | Accepted, but flagged by plagiarism checks (existing `similarity.ts`) and activity anomalies (big pastes, no typing, impossible times) |
| Graded, high stakes (exams) | Local runner for feedback, then **re-checked on sync** by a central judge | Only the re-check result counts. Needs the optional college Linux PC with Judge0 (existing `judge0.provider.ts` and worker). |

- Hidden tests are encrypted per pack. The key is released only after the student signs in and the assessment opens, and is kept in the OS keychain (the existing `keyring`).
- Each attempt record is signed with a per-install key, so a result edited in the database after the fact is detected.
- An attempt is late when the server receipt time is after `closesAt` plus a grace period, unless the monotonic timeline shows it was finished before the deadline and synced at the first chance. Teachers see a "finished offline, synced late" label and decide.

## 9. Calculation (Oracle ATP)

**Load:**
- A credential object (`DBMS_CLOUD.CREATE_CREDENTIAL`) gives ATP read access to the bucket.
- A nightly `DBMS_SCHEDULER` job loads new `raw/activity/**` files into `stg_activity` with `DBMS_CLOUD.COPY_DATA` (JSON format).
- Each loaded file is recorded in `ingested_files`, so files are never loaded twice.

**Calculate**, per student, question, assessment and class:
- time on task; runs before the first Accepted; first-try accept rate
- paste ratio; focus-loss count; idle ratio
- topic mastery (from question tags); streaks; percentile within the class

Results go into `kpi_student_daily`, `kpi_student_topic`, `kpi_assessment` and `kpi_class`.

**Publish:**
- A job sends the changed KPI rows to Supabase in batches with `DBMS_CLOUD.SEND_REQUEST` to the PostgREST endpoint, using a Supabase service key stored as an ATP credential (never in code).
- Upserts use the natural key, so re-running the job is safe.

**Keep ATP awake:** Always Free ATP stops after 7 days without use, and scheduled jobs do not run while it is stopped. A daily external ping (a GitHub Actions cron or the broker) runs a cheap query to keep it awake. A failed nightly run is reported through Oracle Notifications or email.

**Retention:** raw activity in Object Storage for 12 months (lifecycle rule), staging rows in ATP for 30 days, KPI history kept.

**Fallback:** if ATP is not available, the same calculations run in Supabase with `pg_cron`. The KPI table shapes stay identical, so dashboards do not change.

## 10. Supabase (operational data and serving)

**Tables:** organisations, users and roles, departments, classes, courses, course pack versions, assessments, enrolments, submissions (code and verdicts), feedback, the `kpi_*` tables pushed by ATP, and notifications.

**Access rules (RLS):**
- A student reads only their own rows.
- A teacher reads rows for classes they are assigned to.
- A college admin reads rows for their college.
- `kpi_*` tables are read-only for every user. Only the ATP service key writes them.

**Login, decision D2:**
- **D2-A (recommended): Supabase Auth with email codes**, sending through Brevo as custom SMTP.
  - Desktop app and dashboards use the same login.
  - RLS uses `auth.uid()` and a role claim.
  - The existing `integrations/supabase.ts` already verifies Supabase tokens on the API side, so the old API can keep working during the move.
- **D2-B:** keep our current login and have it issue tokens Supabase accepts (Supabase third-party auth). Less rewriting at first, but two systems to keep secure.

**Size:** 500 MB is enough for operational data and calculated KPIs, because raw activity lives in Oracle. Submissions store code text only, with no compiled output. Watch usage monthly; Pro is the upgrade path.

## 11. Dashboards (GitHub Pages)

- A separate **public** repository holding only the static site (Vite + React). Free GitHub Pages needs a public repo, and this site holds no secrets.
- It uses supabase-js with the Supabase **anon** key, which is safe to publish because RLS does all access control. The service key is never used here.
- Pages:
  - **Student:** my progress, topics, assessments, history.
  - **Teacher:** class overview, per-assessment results, per-student drill-down, code review, flags.
  - **College admin:** departments, classes, usage.
- Hosted on `dash.yourdomain`, with the custom domain on GitHub Pages and HTTPS enforced. Login redirect URLs are set in Supabase.
- Teacher writes (create assessment, publish pack, grade, feedback) go to Supabase through RLS. Pack building and signing go through the broker (§12).
- GitHub's terms say Pages is not for running a commercial SaaS. If this becomes a paid product, move the same static build to Cloudflare Pages; no code change is needed.

## 12. Broker (the only server logic left)

This is a small service with five jobs. It runs as Supabase Edge Functions or on Oracle micro #1 (decision D3).
1. **Upload URLs:** checks the user and returns an Object Storage pre-authenticated request, valid for 15 minutes, scoped to one object path under `raw/activity/{org}/…`.
2. **Download URLs** for packs the user is enrolled in.
3. **Publish:** builds and encrypts a course or assessment pack from Supabase data and uploads it. Signing uses the pack-signing key. Language packs are signed offline by the release key (§4).
4. **Assessment keys:** releases per-pack test keys when an assessment opens.
5. **Re-check queue:** when high-stakes re-checking is on (§8), puts attempts into the existing `execution_jobs` style queue for the college judge PC.

The Oracle signing key and Supabase service key exist only here, as deployment secrets.

## 13. What happens to the current code

| Area | Fate |
| --- | --- |
| Desktop: SQLite store, outbox, drafts, notes, course cache | **Kept**, extended (§7) |
| Desktop: Monaco workspace, activity tracking, OTP login screen | **Kept** |
| `packages/language-config` (languages, `outputsMatch`, verdicts) | **Kept**, shared by runner and dashboards |
| `content/j-platform-question-bank` | **Kept**, becomes the first practice pack |
| API: Judge0 provider, worker, `execution_jobs` | **Kept only for optional re-checking** (§8) |
| API: OCI storage adapter | **Reused** by the broker |
| API: `similarity.ts` | **Reused** on sync (moved into the broker or a Supabase function) |
| API: Fastify routes and Drizzle schema | Become the source for the Supabase schema. Most routes are **retired** after the move. |
| Web: Next.js consoles | **Retired** after the GitHub Pages dashboards cover the same screens. Kept running until then. |
| Remote terminal | Not needed; stays disabled |

Nothing is deleted until its replacement is verified (rule from the master prompt).

## 14. Free-tier limits

| Limit | Value | How the design stays under it |
| --- | --- | --- |
| Object Storage size | 20 GB | Packs about 1 GB total; raw activity compressed with a 12-month lifecycle |
| Object Storage requests | about 50k/month | Batch uploads (one file per batch); packs downloaded once per version |
| ATP | 1 OCPU, 20 GB, stops after 7 idle days | Nightly batch only; daily keep-alive ping |
| Supabase DB | 500 MB, pauses after 7 days idle | No raw activity; daily ping; Pro if needed |
| Supabase Edge Functions | 500k calls/month | Only the broker's five jobs |
| Brevo | about 300 emails/day | Codes only at sign-in on a new device; 30-day sessions |
| GitHub Pages | 1 GB site, about 100 GB/month bandwidth | Static dashboards are a few MB |

Check these numbers against each provider's current terms before launch.

## 15. Build order and done criteria

| Phase | Work | Done when |
| --- | --- | --- |
| 1 | Language pack manager and index signing | Fresh Windows VM with no Java: app downloads Java, verifies, runs Hello World; corrupt or unsigned pack is refused |
| 2 | Local runner | Python, C, C++, Java each give correct AC/WA/CE/RE/TLE/MLE verdicts in Rust tests; a fork bomb and an infinite loop are contained |
| 3 | Course pack format, publish and download | J question bank published as a pack; student solves a question fully offline after one download |
| 4 | Sync to Supabase and Object Storage | Offline work for several days syncs once online; duplicates are ignored; crash in the middle of sync loses nothing |
| 5 | Supabase schema, RLS, login (D2) | RLS tests: student sees only self, teacher only own classes |
| 6 | ATP load, KPI jobs, push to Supabase | Sample raw files produce expected KPI rows; re-run is idempotent; keep-alive works |
| 7 | GitHub Pages dashboards | Student and teacher dashboards show real synced data at desktop and 390 px width |
| 8 | Assessments (time window, keys, late rules) | Teacher creates assessment → student attempts offline → syncs → teacher sees results with correct late labels |
| 9 | Optional high-stakes re-check | College judge PC re-checks attempts; tampered local result is caught |

## 16. Open decisions

| ID | Decision | Recommendation |
| --- | --- | --- |
| D1 | How strict graded work must be | Practice and low-stakes local; re-check only exams (§8) |
| D2 | Login: Supabase Auth or our own | D2-A, Supabase Auth with Brevo SMTP |
| D3 | Broker host: Supabase Edge Functions or Oracle micro | Edge Functions (nothing to maintain); micro if Oracle request signing is awkward there |
| D4 | KPI calculation: ATP or Supabase `pg_cron` | ATP as you asked; `pg_cron` as the fallback with identical tables |
| D5 | Which OS to support first | Windows x64 first; macOS and Linux after phase 4 |
| D6 | C/C++ on macOS/Linux: bundle or use system compiler | Use the system compiler if present, else offer the pack |
| D7 | Domain name | Needed before email setup and dashboards |
