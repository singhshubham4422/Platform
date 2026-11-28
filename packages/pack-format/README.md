# @platform/pack-format

Shared, dependency-light builders and validators for signed language indexes and `.lpack` files. The JSON shapes follow the [offline-first master contracts](../../docs/codex/offline-first/00-MASTER-PROMPT.md#c2-signing).

The library uses Web Crypto and `fflate`, so `index.js` can be imported from Node 24 and Deno. Detached Ed25519 signatures cover the exact archive or index bytes. AES-256-GCM hidden-test files use a fresh 12-byte nonce.

## CLI (PowerShell)

```powershell
node packages/pack-format/bin/pack-builder.mjs keygen --role pack --out .local/keys
node packages/pack-format/bin/pack-builder.mjs import-jplatform --in content/j-platform-question-bank/questions.json --out .local/packs/jbank-source.json --course-id 7b0f5d7e-2b8c-4e47-9d0a-6a2c4f1d9e01 --version 1 --title "Java Practice (imported, unreviewed)"
node packages/pack-format/bin/pack-builder.mjs course-pack --source .local/packs/jbank-source.json --out .local/packs --seed .local/keys/pack.seed
```

The generated practice pack is written to `.local/packs/<courseId>/<version>.lpack` with a detached `.lpack.sig` alongside it. Use `verify --file ... --sig ... --pub .local/keys/pack.pub --kind pack` to verify it.

## Key handling

Keep the release signing seed offline. The `PACK_SIGNING_KEY` secret is used only by the edge function that signs course and assessment packs. CLI output never includes private seed material; keygen writes seeds to the requested local directory with restrictive permissions where supported. Never commit generated keys or packs.
