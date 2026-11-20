#!/usr/bin/env bash
# Runs inside the deployed stack: checks Isolate's own environment test and executes the
# four "Hello World" programs through the authenticated Judge0 API. Exit 0 only if all pass.
# Usage: JUDGE0_URL=http://<private-ip>:2358 JUDGE0_AUTH_TOKEN=... ./scripts/verify-isolation.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JUDGE0_URL:?}" "${JUDGE0_AUTH_TOKEN:?}"

echo "== Isolate environment (inside worker)"
docker compose exec -T worker bash -lc 'isolate --version | head -1; isolate-check-environment --execute 2>&1 | tail -20'

run() { # lang_id name source expected
  local body token res out status
  body=$(jq -n --arg s "$3" --argjson l "$1" '{language_id:$l, source_code:$s, stdin:"", enable_network:false}')
  token=$(curl -fsS -H "X-Auth-Token: $JUDGE0_AUTH_TOKEN" -H 'Content-Type: application/json' -d "$body" "$JUDGE0_URL/submissions?base64_encoded=false" | jq -r .token)
  for _ in $(seq 1 60); do
    res=$(curl -fsS -H "X-Auth-Token: $JUDGE0_AUTH_TOKEN" "$JUDGE0_URL/submissions/$token?base64_encoded=false&fields=status,stdout,stderr,compile_output,message")
    status=$(jq -r .status.id <<<"$res"); [[ $status -gt 2 ]] && break; sleep 1
  done
  out=$(jq -r '.stdout // ""' <<<"$res" | tr -d '\r' | sed -e 's/[[:space:]]*$//')
  if [[ $status -eq 3 && "$out" == "$4" ]]; then echo "  [PASS] $2"; else echo "  [FAIL] $2 → $(jq -c . <<<"$res")"; return 1; fi
}

echo "== Real execution through Judge0"
rc=0
run 71 "Python 3" 'print("Hello World")' "Hello World" || rc=1
run 50 "C (GCC)" $'#include <stdio.h>\nint main() { printf("Hello World\\n"); return 0; }' "Hello World" || rc=1
run 54 "C++ (G++)" $'#include <iostream>\nint main() { std::cout << "Hello World\\n"; }' "Hello World" || rc=1
run 62 "Java" $'class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello World");\n  }\n}' "Hello World" || rc=1
[[ $rc -eq 0 ]] && echo "Isolation smoke test PASSED. Next: pnpm test:judge0 from the API host." || echo "FAILED — keep ENABLE_STUDENT_EXECUTION=false"
exit $rc
