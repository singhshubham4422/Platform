# Judge0 production deployment (Linux)

Student code runs only here: Judge0 CE **1.13.1** (official image `judge0/judge0:1.13.1`, pinned by digest in `../Dockerfile`) on a **dedicated Ubuntu 22.04 LTS x86_64 VM** that hosts nothing else. The platform API talks to it over a private network with an `X-Auth-Token`. Students and browsers never reach Judge0.

> **Status:** these files are ready, but no supported Linux host was available when they were written. Nothing has run through isolated Judge0 yet. Keep `ENABLE_STUDENT_EXECUTION=false` on the API until §Acceptance passes on the real VM.

## Why a dedicated cgroup-v1 host

Judge0 CE 1.13.1 runs each program through the Isolate version bundled in its image. That Isolate enforces CPU, memory and process limits with **cgroup v1** controllers (`memory`, `cpuacct`, `cpuset`, `pids`). Ubuntu 22.04, Docker Desktop and WSL2 boot with unified cgroup v2 by default. On such hosts, `isolate-check-environment` reports those controllers missing and submissions fail with `Internal Error`. That is exactly what happened on the development workstation.

Judge0's own deployment guide for 1.13.x switches the VM to cgroup v1. This is a documented requirement for this pinned version, not a random kernel tweak. Do **not** remove resource limits, disable Isolate or run student code elsewhere to work around it.

## Host preparation (once, as root)

1. Provision Ubuntu 22.04 LTS with 4+ vCPU, 8+ GiB RAM and 50 GiB disk. Give it a private IP and **no public inbound rules**.
2. Install Docker Engine and the Compose plugin from Docker's apt repository. Pin the versions you validated.
3. Enable cgroup v1 plus swap accounting, then reboot:
   ```bash
   sudo sed -i 's/^GRUB_CMDLINE_LINUX="\(.*\)"/GRUB_CMDLINE_LINUX="\1 systemd.unified_cgroup_hierarchy=0 swapaccount=1"/' /etc/default/grub
   sudo update-grub && sudo reboot
   ```
4. Run `sudo bash scripts/preflight.sh`. It changes nothing and must print `Preflight PASSED`.

## Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing          # image pulls/updates; tighten to your mirror if possible
sudo ufw allow from <ADMIN_BASTION_IP> to any port 22 proto tcp
sudo ufw allow from <PLATFORM_API_PRIVATE_IP> to any port 2358 proto tcp
sudo ufw enable
```

Containers on `judge-private` (workers, database, Redis) have no external route. Student programs run with `ENABLE_NETWORK=false` and `ALLOW_ENABLE_NETWORK=false`. Docker publishes port 2358 only on `JUDGE0_BIND_ADDR` (the private IP). If the API and judge are not on the same trusted private network, put a TLS reverse proxy (Caddy or nginx) in front of 2358 with an internal certificate, and point `JUDGE0_URL` at `https://…`.

## Install

```bash
sudo mkdir -p /opt/platform-judge && sudo cp -r infra/judge/. /opt/platform-judge/   # Dockerfile + production/
cd /opt/platform-judge/production
cp judge0.conf.example judge0.conf          # replace every <…> with openssl rand -hex 32 output
cp judge0.conf judge0.env && chmod 600 judge0.conf judge0.env
export JUDGE0_BIND_ADDR=<vm-private-ip>
docker compose up -d --build --wait
```

On the **API host**, set `JUDGE_PROVIDER=judge0`, `JUDGE0_URL=http://<vm-private-ip>:2358` (or the TLS URL) and `JUDGE0_AUTH_TOKEN=<AUTHN_TOKEN>`. Never give the API `AUTHZ_TOKEN`, the Judge0 database password or the Redis password. Run the platform judge worker (`pnpm --filter @platform/api judge:worker:start`) on the API side. It holds the platform database credentials, never the Judge0 VM.

## Acceptance (required before enabling execution)

1. `JUDGE0_URL=… JUDGE0_AUTH_TOKEN=… bash scripts/verify-isolation.sh`. This prints the Isolate version and environment check, then runs Python/C/C++/Java Hello World through the API.
2. From the API host: `pnpm test:judge0`. This is the platform's real-Judge0 suite: correct output, wrong answer, compile error, runtime error, time limit, memory limit, hidden tests through the platform API, and service-unavailable handling.
3. Record the date, host, kernel, `docker info` CgroupVersion, Isolate version and the test output in `docs/operations/` as release evidence.
4. Only then set `ENABLE_STUDENT_EXECUTION=true` on the API and restart it. The API refuses execution and returns 503 whenever Judge0 is unhealthy.

## Operations

- **Health:** `docker compose ps`; `curl -H "X-Auth-Token: $AUTHN_TOKEN" http://$JUDGE0_BIND_ADDR:2358/workers` (queue depth per language). The platform's `/admin/platform/health` page shows judge and queue status.
- **Backup:** `bash scripts/backup.sh /var/backups/judge0` (nightly cron). The Judge0 database holds transient run records only; grades and submissions live in the platform PostgreSQL, which needs its own backup.
- **Restore:** `bash scripts/restore.sh <file.sql.gz>`. It verifies the checksum, stops server and workers, restores, restarts, then you rerun §Acceptance. Test a restore before go-live.
- **Upgrade:** take a backup, change the digest in `../Dockerfile` to the new release, then `docker compose build && docker compose up -d --wait`, then rerun §Acceptance. Newer Judge0 releases change cgroup requirements, so read their release notes first and rerun `preflight.sh`.
- **Rollback:** restore the previous Dockerfile digest, run `docker compose up -d --wait`, and restore the pre-upgrade backup if the schema changed.
- **Never** run `docker compose down -v`. It deletes the Judge0 database and Redis volumes.

## Security notes

Judge0 CE requires `privileged: true` containers for Isolate. Treat the VM as an untrusted-execution zone: no other services, no platform secrets, no SSH agent forwarding, and regular OS patching. For stronger isolation, run the VM inside a separate project or VPC and consider gVisor or Firecracker-based alternatives in a later phase. Sandbox escape testing (host files, metadata endpoints `169.254.169.254`, the internal network, fork bombs) is part of release sign-off.
