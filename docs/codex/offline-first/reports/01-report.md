# Phase 01 report — pack formats, signing and pack builder

**Summary:** Implemented `@platform/pack-format` with Web Crypto Ed25519 and AES-256-GCM helpers, pack/index validators, deterministic pack generation and signed archive reading. Added the Node/Deno-oriented CLI and the deterministic J_Platform question-bank converter. All Node tests and repository checks passed; Deno execution could not be verified because Deno is not installed in this environment.

**Overall status:** Implemented, not verified (Deno runtime check blocked).

## Status table

| Task | Status | Exact command | Result |
| --- | --- | --- | --- |
| 1. Package skeleton and dependency | Verified | `pnpm install --frozen-lockfile` | Lockfile is up to date; completed with pnpm 12.18.0. |
| 2. Crypto and encryption | Verified (Node); Blocked (Deno) | `pnpm --filter @platform/pack-format test` | 10 tests passed, including signing, tampering, malformed signatures, AES-GCM decrypt and wrong-key rejection. `deno --version` failed because the executable is unavailable. |
| 3. Validators | Verified | `pnpm --filter @platform/pack-format test` | Language index, manifest, question and archive path cases passed. |
| 4. Build and read packs | Verified | `pnpm --filter @platform/pack-format test` | Deterministic bytes, signature-first validation, re-signed hash tampering, unsafe/oversized archives and encrypted assessment behavior passed. |
| 5. Language index helpers | Verified | `pnpm --filter @platform/pack-format test` | Entry sizing and hashing, sorted output, and trailing newline passed. |
| 6. CLI and J_Platform importer | Verified | `node packages/pack-format/bin/pack-builder.mjs verify --file .local/packs/7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01/1.lpack --sig .local/packs/7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01/1.lpack.sig --pub .local/keys/pack.pub --kind pack` | `OK`; CLI test also verified tampering exits 1 with `SIGNATURE_INVALID`. The converter produced 240 stable question IDs and no solutions. |
| 7. Type declarations | Implemented, not verified separately | `pnpm typecheck` | Root TypeScript checks passed. Package-local `typecheck` was omitted because `packages/language-config` has no such script and this package adds no TypeScript tooling. |
| 8. README and key guidance | Verified | `git diff --check` | No whitespace errors. |

## Repository checks

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Verified — lockfile up to date. |
| `pnpm lint` | Verified — all four workspace package lint scripts completed. |
| `pnpm typecheck` | Verified — API, web and desktop TypeScript checks completed after the production build finished. |
| `pnpm test` | Verified — language config 4, pack format 10, API 27, desktop 25 and web 58 tests passed. |
| `pnpm test:integration` | Verified — 3 files and 24 integration tests passed. |
| `cargo +stable fmt --manifest-path apps/student-desktop/Cargo.toml --all -- --check` | Verified — exit code 0. |
| `cargo +stable clippy --manifest-path apps/student-desktop/Cargo.toml --all-targets -- -D warnings` | Verified — finished successfully. |
| `cargo +stable test --manifest-path apps/student-desktop/Cargo.toml` | Verified — 6 passed, 0 failed. |
| `pnpm build` | Verified — API, desktop and web builds completed. Vite reported its existing large Monaco chunk warning. |
| `pnpm --filter @platform/pack-format lint` | Verified — JavaScript syntax checks passed. |
| `pnpm --filter @platform/pack-format test` | Verified — 10 passed, 0 failed. |
| `node packages/pack-format/bin/pack-builder.mjs keygen --role pack --out .local/keys` | Verified — generated local key files; only the public key was printed. |
| `node packages/pack-format/bin/pack-builder.mjs import-jplatform --in content/j-platform-question-bank/questions.json --out .local/packs/jbank-source.json --course-id 7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01 --version 1 --title "Java Practice (imported, unreviewed)"` | Verified — wrote 240 questions. |
| `node packages/pack-format/bin/pack-builder.mjs course-pack --source .local/packs/jbank-source.json --out .local/packs --seed .local/keys/pack.seed` | Verified — wrote the `.lpack`. |
| `node packages/pack-format/bin/pack-builder.mjs verify --file .local/packs/7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01/1.lpack --sig .local/packs/7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01/1.lpack.sig --pub .local/keys/pack.pub --kind pack` | Verified — `OK`. |

## Files changed

- `packages/pack-format/package.json`
- `packages/pack-format/index.js`
- `packages/pack-format/index.d.ts`
- `packages/pack-format/bin/pack-builder.mjs`
- `packages/pack-format/test/pack-format.test.mjs`
- `packages/pack-format/README.md`
- `pnpm-lock.yaml`
- `docs/codex/offline-first/reports/01-report.md`

## Contract changes

- **ADDED BY PHASE 01:** optional `status` on the generated manifest to carry the J_Platform import status `IMPORTED_UNREVIEWED`.
- **ADDED BY PHASE 01:** converter-only `assetsNotice` in the intermediate source JSON; the builder places its bytes at `assets/NOTICE.md` and lists it in `files[]`.

## Integration notes for Claude

- Deno should import the shared package from `supabase/functions/_shared/` using the workspace relative path `../../../packages/pack-format/index.js`; its library entry uses Web Crypto and `fflate`, without Node APIs.
- CLI output is `.local/packs/<courseId>/<version>.lpack` plus `<version>.lpack.sig`; imported source is `.local/packs/jbank-source.json`.
- No questions needed moving from hidden to visible; the import completed without warnings. Generated source and pack tests confirm every question has a visible test.
- This phase adds no `TODO(offline-integration)` markers.
- Root TypeScript checks passed, but package declarations were not separately checked because the existing `packages/language-config` pattern has no package-local typecheck script.

## Blocked items

- Deno runtime verification is blocked because `deno` is not installed. Owner must provide Deno 2.x (or make it available on `PATH`) to run an import/crypto smoke check before the Deno edge-function integration.

## Commit

- `feat(pack-format): shared formats and signing (phase 01)` — hash is recorded in `FINAL-SUMMARY.md` after the phase commit.
