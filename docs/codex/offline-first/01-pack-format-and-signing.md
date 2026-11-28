# Phase 01 — Pack formats, signing and the pack builder CLI

Track A, first phase. It can run in parallel with phase 06. Read `00-MASTER-PROMPT.md` first; its rules and contracts C1–C5 apply.

## Goal
One shared, dependency-light package that **creates, signs, reads and verifies** language-pack indexes and course/assessment packs exactly as in contracts C2–C5.
- It works in Node 24 and in Deno (used by phase 07 edge functions).
- It ships a CLI the owner uses to build packs and dev keys.
- It ships a converter that turns the 240-question J bank into the first practice pack source.

## Read first
- `packages/language-config/{index.js,index.d.ts,package.json,index.test.mjs}`: copy this package's style (plain ESM + `.d.ts`, `node --test`, no build step).
- `content/j-platform-question-bank/questions.json`: `meta` + `questions[]` with `slug, title, difficulty (Beginner|Easy|Medium|Hard), category, description, constraints, starterCode, solutionCode, language, testCases[{input, expectedOutput, isHidden}]`.
- `content/j-platform-question-bank/J_PLATFORM_THIRD_PARTY_NOTICES.md`.
- `apps/api/src/db/schema/unified.ts` (`coursePackages`), for awareness only.

## Allowed paths
- Create `packages/pack-format/**`.
- Modify `pnpm-lock.yaml` (adding `fflate`).
- Create `docs/codex/offline-first/reports/01-report.md`.

Nothing else.

## Tasks
1. **Package skeleton:** `packages/pack-format/package.json`.
   - Name `@platform/pack-format`, `"type": "module"`, `exports` with `types` and `default`.
   - Scripts: `test` (`node --test`), `lint` (`node --check` on every `.js`/`.mjs` file, matching the repo's lint style; see how other packages lint and keep it equivalent), `typecheck` (`tsc --noEmit -p tsconfig.json` with `allowJs`/`checkJs` over `index.d.ts` only, or omit if language-config has none and say so).
   - Dependency: `fflate` 0.8.x.
   - The `bin` field maps `platform-pack` to `bin/pack-builder.mjs`.
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

## Tests (`packages/pack-format/test/*.test.mjs`; keys generated per test, nothing committed)
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

## Verification (add to the report)
```
pnpm --filter @platform/pack-format test
node packages/pack-format/bin/pack-builder.mjs keygen --role pack --out .local/keys
node packages/pack-format/bin/pack-builder.mjs import-jplatform --in content/j-platform-question-bank/questions.json --out .local/packs/jbank-source.json --course-id 7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01 --version 1 --title "Java Practice (imported, unreviewed)"
node packages/pack-format/bin/pack-builder.mjs course-pack --source .local/packs/jbank-source.json --out .local/packs --seed .local/keys/pack.seed
node packages/pack-format/bin/pack-builder.mjs verify --file .local/packs/<courseId>/1.lpack --sig .local/packs/<courseId>/1.lpack.sig --pub .local/keys/pack.pub --kind pack
```
Plus the master §7 checks.

## Must not
- No Node-only APIs in `index.js` (`fs`, `path`, `Buffer`, `node:crypto`). Only Web APIs and `fflate`, so Deno can import it. The CLI may use Node APIs.
- No `solutionCode` or reference solutions in any pack.
- No committed keys, generated packs or `.local/` content.

## Integration notes to leave
- The exact import path phase 07 should use from Deno (relative path from `supabase/functions/_shared/`).
- The CLI output layout used under `.local/packs/`.
- The questions moved from hidden to visible during import (slugs).
