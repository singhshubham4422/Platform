# Phase 07 — OCI broker edge functions report

Status: **Incomplete**. Added authenticated edge handlers for one-object activity uploads, RLS-scoped pack downloads, permission-checked course pack publishing, and class invitations. OCI Request Signatures use RSA-SHA256 with Oracle's basic and JSON-body header sets. Pack format is generated from the shared package source; J-bank import uses the existing converter and writes stable IDs as `DRAFT` / `IMPORTED_UNREVIEWED` without solution-code columns.

## Verification

- `pnpm test` — all workspace tests passed (5 edge tests, 10 pack-format tests, 27 API unit tests, 32 desktop tests, and 58 web tests). The J-bank database test is deliberately run by `test:supabase` against an isolated database rather than the root unit command.
- `pnpm test:supabase` — 5 PostgreSQL tests passed, including two consecutive imports of the 240-question J-bank fixture and assertions for stable counts, review status, and absence of solution columns.
- `pnpm check:edge-sync` — generated `pack-format.js` matches `packages/pack-format/index.js`.
- `node --check` passed for shared handlers, OCI signing, pack-format import tooling, and J-bank import tooling.
- Deno type check: **Implemented, not verified** because Deno is not installed in this environment. Live OCI PAR upload/download and expiration checks are **Blocked** until the owner provides OCI credentials and a staging bucket.

## Security notes

- All four routes require a valid Supabase bearer token. Pack downloads read metadata through the user-scoped RLS client. Publishing checks `rls_can_manage_course` before using the service client or writing objects.
- Upload PARs are limited to one generated user/org path, one object, and 15 minutes; pack PARs are read-only and also expire after 15 minutes. PAR URLs are not persisted.
- Invites check caller role and class/organization scope before using the Auth Admin API. Failed profile or membership creation deletes the newly invited user.
- Publish failures after object writes log the orphan course/version identifiers without exposing credentials.
- The private object-storage bucket, disabled versioning, and 365-day stale-upload lifecycle policy are documented in `supabase/README.md`; their live configuration was not verifiable here.

## Follow-up

- Install/use Deno and run `deno check` for the four entrypoints.
- Deploy to staging, validate the real OCI PAR operations and expiration, and confirm invitation email redirect configuration.
- Current automated edge tests cover signature verification, upload scoping/size bounds, RLS-hidden downloads, and publish denial before privileged reads. They do not yet exercise every handler success/failure branch against Supabase/OCI mocks.
