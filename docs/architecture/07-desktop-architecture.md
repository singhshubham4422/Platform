# Desktop architecture

L_Platform is the only desktop source present: Tauri 2, React/TypeScript, Rust shell, CodeMirror 6, Pyodide-based offline Python and a Windows keyring dependency. The README describes assignment drafts/queue and results. The app package has storage and smoke tests plus a Tauri configuration. Its UI is not Monaco and its Rust SQLite responsibilities need implementation-level verification before expansion.

J_Platform README describes an Electron client and bundled OpenJDK 21, but Electron main/preload/server/client sources are absent. Do not remove or claim parity with that application based on README alone.

## Target

Continue L Tauri incrementally. Keep UI in React; use Rust for native credential storage, SQLite, files/checksums and sync only where implemented. Use a generated API client. SQLite is cache/outbox, never grade authority. Preserve Python offline execution as a clearly labeled practice mode; graded execution is remote and online. Evaluate Monaco migration only after the missing J source is restored and UX parity is measured.

## Readiness

Run frontend and Rust checks on native targets, exercise credential storage/logout, SQLite migrations, crash-safe idempotent outbox, checksum downloads and reconnect conflict handling. Those desktop checks were not run in this audit.
