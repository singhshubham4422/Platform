# Offline synchronization design

## Verified state

L student README describes offline resources, Python practice, drafts and a submission queue. Tests named `storage.test.ts` and `smoke.test.ts` exist. Actual Rust-backed SQLite, checksummed package manifests and full cursor semantics were not established in this workspace audit. J README claims local SQLite and sync, but its runtime source is absent.

## Target protocol

Desktop stores cached manifests/resources, drafts, notes, cursors and an outbox in SQLite. Each operation has a UUID idempotency key, entity IDs, schema version, local timestamp, bounded payload, attempt count and state. Sync authenticates/rotates session, fetches cursor changes, uploads idempotent events/drafts, then applies server changes and advances cursor transactionally.

Draft conflicts use version/updated-at compare and explicit user-visible resolution; notes may merge only under a defined policy. Submissions are queued but remain ungraded until server acknowledgment. Grades/results are server-authoritative. Old offline state must never overwrite newer grade or assessment state. Course package downloads validate size/checksum and update incrementally.

## Recovery tests

Test crash between enqueue/send/ack, duplicate retry, revoked session, expired access token, network loss, stale draft, partial resource download and corrupt checksum before claiming reliable offline sync.
