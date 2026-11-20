# Target architecture

## Decision

Use L_Platform's existing Fastify + TypeScript + Drizzle + PostgreSQL backend as the initial modular monolith and authoritative academic system. This is evidence-based and revises the requested “existing Express” assumption: no Express backend exists in the inspected L project. Keep its deployed database choice if deployment confirms it; do not introduce Oracle or Prisma.

```text
Tauri student app (React/TS, Rust native services, local cache)
                 | versioned HTTPS API
Next.js staff portal (admin / faculty / HOD)
                 | versioned HTTPS API
Fastify modular monolith (identity, tenant, academic, content,
 assessment, submissions, storage, reporting, audit)
       | PostgreSQL/RLS   | private object storage
       | durable queue   | private judge adapter -> isolated Judge0 CE
```

J_Platform is not presently integrable as a running service because its application/backend sources are missing. Restore sources before selecting components to port. Keep optional import tooling separate from runtime so content can be reconciled without making two databases authoritative.

## Boundaries

- Backend owns identity mapping, role resolution, organization scope and API contracts.
- PostgreSQL remains authoritative for academic data and grades; local SQLite holds cache/outbox only.
- Object storage holds documents/packages; database holds metadata and access policy.
- Judge is a replaceable provider behind an application-owned job state machine. No source runs in API/database processes.
- Web and desktop consume generated/versioned OpenAPI clients and never import backend source.
- Faculty/organization/platform consoles are role-specific surfaces over one API, not separate products.

## Migration direction

Use additive PostgreSQL changes, stable UUID identifiers for new records, compatibility views/columns as needed, and explicit backfills. Existing L primary keys are text; inspect actual values and every FK/RLS policy before changing key types. Do not bulk-cast or reset data without a tested migration path.
