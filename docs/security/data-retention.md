# Data retention

This document records the intended handling visible in the current schema and application. It does not create automatic deletion jobs; retention schedules need organization policy and deployment configuration before production.

- Authentication: passwords are hashed; OTP challenges and refresh sessions are database records with expiry/revocation fields. Do not retain delivered OTP message bodies.
- Student work: submissions, code drafts, snapshots, execution metadata, results, and academic records are persisted. Grades and released results remain server-authoritative. No configured automatic purge was verified.
- Hidden tests: remain in private test-case storage; student job responses redact their inputs and expected outputs.
- Activity history: stores application-level events needed for code playback. No system-wide activity, other-app clipboard, or keystroke monitoring is part of the design.
- Files: private object/local storage records metadata and ownership. Configure lifecycle deletion for abandoned uploads and deleted organizations before production.
- Local desktop cache: browser localStorage/IndexedDB currently holds offline data. SQLite migration and a user-visible backup/restore workflow remain incomplete; students should not treat local cache as a durable archive.
- Logs: avoid source code, OTPs, access tokens, and file contents. Define infrastructure log retention and redact request bodies at the platform edge.

Before deployment, set retention periods for rejected/expired invitations, sessions, unsubmitted drafts, snapshots/events, submissions, attachments, audit logs, backups, and deletion requests. Document legal hold and student export/deletion procedures. Test deletion against backups and derived analytics.
