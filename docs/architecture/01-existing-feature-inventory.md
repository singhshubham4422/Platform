# Existing feature inventory

Status labels reflect evidence in the workspace as of 2026-11-20. “Working” means code and a relevant test or integration path were found; it does not imply production deployment validation.

| Capability | L_Platform evidence/status | J_Platform evidence/status | Target reuse/mapping |
|---|---|---|---|
| Organization and user records | Backend schema/routes/tests: working, incompletely production-verified | Admin institute UI/data adapter only; no server | L backend is academic source of truth; map J institute IDs only after restoring its DB |
| Roles and auth | L backend auth, refresh rotation, guards: working and unit-tested; role model limited | Supabase client dependency and README claims; source absent | Preserve L IDs/sessions; migrate memberships additively |
| Tenant isolation | RLS migration/context and security integration suite exist; DB-dependent tests not run | No backend available | Extend L policy/test model; do not rely on frontend filters |
| Course/class/section management | L backend CRUD and web API-backed services; backend tests exist; live DB workflow not verified | Admin institutes portal only | Keep L academic records; verify production adapter contracts |
| Faculty console | L teacher UI pages and backend assignment/question/report routes; web adapter calls backend routes | J admin teacher mode described, only partial UI/source present | Use L teacher console and API; selectively port useful J views |
| Question bank | L DB/routes cover coding and objective/written types; bank content in source; tested partially | Admin authoring UI and generated question index present | Preserve L question IDs/types; import J bank through reviewed importer |
| Assignments/assessments | L schema/routes support assignment and assessment workflows; unit tests exist | Not verifiable beyond UI metadata | L backend source of truth; immutable published snapshots are a gap to audit/implement |
| Student desktop | L Tauri app, CodeMirror, Pyodide, draft/offline queue described; code/tests present | Claimed Electron app not present | Continue L Tauri, do not remove any J desktop until restored and parity measured |
| Monaco editor | Not used by L student app (CodeMirror 6) | Dependency declared but client source absent | Decide later whether to port Monaco after restoring usable J source; no duplicate workspace now |
| Local code execution | L Pyodide browser execution for Python; other languages teacher-reviewed | README claims local multi-language judge; source absent | Keep local Python practice explicitly distinct from graded remote judge |
| Remote judge | L evaluator is unsafe child-process code and not invoked; submissions remain pending | Compose references absent judge services | No production judge exists in checked-out systems; use isolated Judge0 adapter as planned future work |
| Learning resources/course packages | L backend content gateway/download routes and seed/content; full offline package integrity not verified | README claims curated question bank; assets absent except generated question JSON | Keep L resource ownership; package manifests/checksums remain a gap |
| Offline storage/sync | L app has storage/smoke tests and queue claims; native SQLite not established | README claims local SQLite + optional sync; runtime absent | Audit app storage code before expanding; server-authoritative grades |
| Activity/integrity | L has audit and progress tables; no full code playback established | J admin integrity/behaviour views and demo/Supabase adapters exist | Reuse neutral opt-in event concepts only; no cheating conclusions |
| Analytics/reports | L report routes and teacher/admin UI; adapter calls backend, but live DB workflow not verified | Admin data derivation and demo source | Verify report backing and scope through L tenant-scoped backend |
| Object storage | L OCI adapter exists, requires env/config; Supabase integration exists | No actual integration source in checkout | L adapter boundary; private access and short-lived grants need validation |
| Platform owner console | L admin routes/pages cover organizations, users, settings, reports; some mock | J developer portal UI present but no backend | L API; use J question editor assets only after source/permissions review |
| Tauri/Rust | L Tauri 2 configuration and Rust shell present | J Electron source absent | Continue incremental L app architecture |
| CI/release | L subprojects contain workflow/foundation policies | J root workflow metadata exists; referenced sources absent | Preserve subproject release boundaries; add unified checks after code is restored |

## Classification notes

- “UI only” is used for L web flows whose active service adapter persists mock data in localStorage and J admin screens whose real API source is absent.
- The L evaluator is an unsafe demo/utility, not an enabled judge. The code itself documents the risk.
- README-only J claims are classified as planned/unverified in this checkout, not as working features.
