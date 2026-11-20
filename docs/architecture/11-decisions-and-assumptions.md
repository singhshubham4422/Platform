# Decisions and assumptions

1. **L backend is initial academic authority.** Evidence: only L has actual backend routes, PostgreSQL schema, RLS, auth and persisted assessment/submission flows. J backend is absent.
2. **Keep Fastify/Drizzle/PostgreSQL.** The instruction to preserve Express/Prisma is incompatible with actual source. No rewrite is justified.
3. **Do not use L evaluator for student execution.** It directly spawns untrusted programs without isolation and is not used by submission routes.
4. **Do not claim a Judge0 integration exists.** J Compose references infrastructure that is absent; L has no verified provider/worker.
5. **Keep Tauri as the present student shell.** L has real Tauri configuration and source; J Electron is README-only in this checkout. No parity/removal decision is possible.
6. **Web backend adapter is present.** `services` exports the backend adapter; remaining mock modules are not the exported adapter. Verify actual API/database flows before claiming end-to-end readiness.
7. **Do not migrate records yet.** No production schema export, DB connection, J data or Git history is present. Additive migrations require a restorable test DB and reviewed backfill.
8. **Identifiers require compatibility work.** L primary keys are text in inspected schema; the target UUID preference cannot be imposed without checking existing data and FK/RLS constraints.
9. **Tests are reported narrowly.** Foundation/unit checks are not end-to-end or production evidence.
10. **User-provided product requirements remain target, not implementation evidence.** This document set records the observed delta and does not claim SaaS completion.
