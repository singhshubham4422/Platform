#!/usr/bin/env bash
# Verifies a Linux host before installing Judge0 CE 1.13.1. Read-only: changes nothing.
# Exit code 0 only when every hard requirement passes.
set -uo pipefail
fail=0
pass() { printf '  [PASS] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; fail=1; }

echo "== Host"
. /etc/os-release 2>/dev/null || true
echo "  OS: ${PRETTY_NAME:-unknown} | kernel: $(uname -r) | arch: $(uname -m)"
[[ "$(uname -m)" == "x86_64" ]] && pass "x86_64" || bad "Judge0 CE images are x86_64 only"
case "${VERSION_ID:-}" in
  22.04) pass "Ubuntu 22.04 LTS (documented by Judge0 for 1.13.x)";;
  20.04) warn "Ubuntu 20.04: works with cgroup v1 but is past standard support";;
  *) warn "Untested distribution/version; Judge0 documents Ubuntu 22.04";;
esac

echo "== cgroups (Judge0 CE 1.13.1 bundles Isolate that requires cgroup v1)"
fs=$(stat -fc %T /sys/fs/cgroup 2>/dev/null)
if [[ "$fs" == "cgroup2fs" ]]; then
  bad "Unified cgroup v2 is active. Boot with systemd.unified_cgroup_hierarchy=0 (see README §Host preparation)."
else
  pass "cgroup v1 / hybrid hierarchy ($fs)"
  for c in memory cpuacct cpuset pids; do
    if awk -v c="$c" '$1==c && $4==1 {f=1} END {exit !f}' /proc/cgroups; then
      pass "controller $c enabled"
    else
      bad "controller $c missing or disabled"
    fi
  done
fi
grep -q "swapaccount=1" /proc/cmdline && pass "swap accounting on" || warn "swapaccount=1 not on kernel cmdline (memory limits may not cover swap)"

echo "== Docker"
if command -v docker >/dev/null; then
  pass "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"
  docker compose version >/dev/null 2>&1 && pass "$(docker compose version --short 2>/dev/null | sed 's/^/compose /')" || bad "docker compose plugin missing"
  docker info --format '{{.CgroupVersion}}' 2>/dev/null | grep -q '^1$' && pass "docker reports cgroup v1" || bad "docker does not report cgroup v1"
else
  bad "docker not installed"
fi

echo "== Capacity"
cpus=$(nproc); mem_gb=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
[[ $cpus -ge 4 ]] && pass "$cpus vCPUs" || warn "$cpus vCPUs (4+ recommended)"
[[ $mem_gb -ge 8 ]] && pass "${mem_gb} GiB RAM" || warn "${mem_gb} GiB RAM (8+ recommended)"
avail=$(df -BG --output=avail /var/lib/docker 2>/dev/null | tail -1 | tr -dc 0-9)
[[ -n "$avail" && $avail -ge 30 ]] && pass "${avail} GiB free for Docker" || warn "less than 30 GiB free for /var/lib/docker"

echo "== Time and firewall"
timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes && pass "clock synchronized" || warn "NTP not synchronized"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then pass "ufw active"; else warn "ufw not active — apply README §Firewall"; fi

echo
[[ $fail -eq 0 ]] && echo "Preflight PASSED" || echo "Preflight FAILED — do not enable student execution on this host"
exit $fail
