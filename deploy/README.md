# Deploying Uposhom to the free VM

How the production host is built, so it can be rebuilt on any provider in about 30 minutes.
Placeholders are written like `<this>`. **Never commit real secrets, keys, tokens or passwords.**

## What runs where

| Piece | Where |
| --- | --- |
| API, worker, Postgres 16, Caddy | one VM, `docker compose` (`deploy/docker-compose.yml`) |
| Images | built in GitHub Actions, pushed to GHCR (`uposhom-api`, `uposhom-worker`), never built on the VM |
| HTTPS | Caddy + Let's Encrypt for `API_DOMAIN` (a free DuckDNS name is enough) |
| Secrets | `/opt/uposhom/.env` on the VM only, plus the team password manager |
| Deploys | push or merge to `main` runs `.github/workflows/backend-ci.yml` |

The VM must keep one **fixed public IPv4**: Applink allow-lists it. Do not delete or recreate the VM
or its reserved address without telling Applink.

## 1. Create the VM (Google Cloud Always Free)

Free tier covers only: one `e2-micro`, region `us-central1`, `us-east1` or `us-west1`, standard
persistent disk up to 30 GB. Everything else is billed. Verify limits on Google's Free Tier page.

Reserve the IP first, then create the VM:

```bash
gcloud compute addresses create uposhom-ip --region=us-central1 --network-tier=STANDARD

gcloud compute instances create uposhom-vm \
  --zone=us-central1-c \
  --machine-type=e2-micro \
  --provisioning-model=STANDARD --maintenance-policy=MIGRATE \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --network-interface=address=uposhom-ip,network-tier=STANDARD \
  --tags=http-server,https-server
```

Console checklist if you click it together instead:

- Machine: `e2-micro`, provisioning model **Standard**, on host maintenance **Migrate**.
- Boot disk: Ubuntu 24.04 LTS, **Standard persistent disk**, 30 GB.
- Networking: external IPv4 = the reserved address, tick Allow HTTP and Allow HTTPS.
- Data protection: **No backups** (snapshots are not free; Postgres backups go to R2, see below).
- Observability: leave Ops Agent **off** (1 GB RAM is tight).

Set a billing budget alert (for example 1 USD). The in-use external IPv4 address may be billed even on
the free tier, so check the billing report after a day or two.

## 2. Prepare the host

SSH in (console SSH button or `gcloud compute ssh uposhom-vm --zone=us-central1-c`), then:

```bash
# 2 GB swap
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker
curl -fsSL https://get.docker.com | sudo sh
getent group docker                     # must print a line, otherwise the install did not finish
sudo usermod -aG docker $USER

# App directory
sudo mkdir -p /opt/uposhom/deploy && sudo chown -R $USER /opt/uposhom
```

Log out and back in, then check:

```bash
docker run --rm hello-world
free -h                                 # Swap: 2.0Gi
curl -4 https://api.ipify.org           # the egress IP: give this to Applink
```

## 3. DNS

Create a free name at duckdns.org (`<your-subdomain>.duckdns.org`) pointing at the VM's static IP.
Check with `nslookup <your-subdomain>.duckdns.org`. Keep the DuckDNS token private; you do not need it
because the IP is static.

## 4. Create `/opt/uposhom/.env`

The compose file reads it through `env_file: ../.env`. Start from `.env.example`. Use hex secrets so
nothing breaks inside `DATABASE_URL`.

```bash
PG_PASS=$(openssl rand -hex 24)
CB_KEY=$(openssl rand -hex 24)
JWT=$(openssl rand -hex 32)

cat > /opt/uposhom/.env <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

API_DOMAIN=<your-subdomain>.duckdns.org

POSTGRES_USER=uposhom
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=uposhom
DATABASE_URL=postgres://uposhom:${PG_PASS}@postgres:5432/uposhom

JWT_SECRET=${JWT}

APPLINK_APP_ID=
APPLINK_PASSWORD=
APPLINK_CALLBACK_PATH_KEY=${CB_KEY}
EOF

chmod 600 /opt/uposhom/.env
unset PG_PASS CB_KEY JWT
```

Notes:

- Set `POSTGRES_PASSWORD` **before the first start**. Postgres only reads it when it creates the data
  volume; changing it later does not change the database user.
- Store the Postgres password and `APPLINK_CALLBACK_PATH_KEY` in the password manager. The callback key
  is part of the five URLs registered with Applink and must stay stable.
- `APPLINK_APP_ID` and `APPLINK_PASSWORD` arrive by email after Applink approves the application. Add
  them with `nano /opt/uposhom/.env`, then `cd /opt/uposhom && docker compose -f deploy/docker-compose.yml up -d`.
- `JWT_SECRET` signs access tokens and is mandatory in production (the API refuses to boot without 32+ characters). Changing it logs everyone's access tokens out (refresh tokens survive). On an existing VM add it by hand: `echo "JWT_SECRET=$(openssl rand -hex 32)" >> /opt/uposhom/.env`.
- Add the other variables from `.env.example` (endpoint URLs, JWT, R2, OpenRouter) when the code needs them.

## 5. Let GitHub Actions deploy

The deploy job connects over SSH as the VM user. Do these once.

**a. Create a dedicated key on your own machine** (no passphrase, CI cannot type one):

```powershell
New-Item -ItemType Directory -Force $HOME\.ssh | Out-Null
ssh-keygen -t ed25519 -f $HOME\.ssh\uposhom_deploy -C "<vm-user>" -N '""'
```

**b. Register the public key in the VM's metadata, not in `~/.ssh/authorized_keys`.** Google's guest
agent rewrites `authorized_keys` and silently drops hand-added lines.

Console: Compute Engine, VM instances, click the VM name, Edit, SSH Keys, Add item. Paste the contents of
`uposhom_deploy.pub` and make sure the **last word (the comment) is the VM username**, for example
`ssh-ed25519 AAAA... <vm-user>`. Save, wait about a minute, then test:

```powershell
ssh -i $HOME\.ssh\uposhom_deploy <vm-user>@<VM_STATIC_IP> "echo ok"
```

**c. GitHub secrets** (repo, Settings, Secrets and variables, Actions, **Repository secrets**):

| Secret | Value |
| --- | --- |
| `PROD_SERVER_IP` | the VM's static IP |
| `PROD_SERVER_USER` | `<vm-user>` (type it by hand; a trailing space breaks login) |
| `PROD_SSH_PRIVATE_KEY` | the whole private key file, `BEGIN` to `END` lines included |

Copy the key with Unix line endings, then clear the clipboard:

```powershell
(Get-Content $HOME\.ssh\uposhom_deploy -Raw) -replace "`r`n","`n" | Set-Clipboard
Set-Clipboard -Value $null
```

**d. Let the VM pull private images from GHCR.** Create a classic personal access token with only
`read:packages` and a sensible expiry, then on the VM:

```bash
docker login ghcr.io -u <github-username>     # paste the token at the password prompt
```

(Alternatively make the two packages public, which needs no token.) The token expires: put the date
in the calendar, and re-run the login with a new token before then.

## 6. Deploy

Merge to `main`. The workflow runs the tests, builds and pushes both images, copies
`deploy/docker-compose.yml` and `deploy/Caddyfile` to `/opt/uposhom/deploy/`, pulls, runs
`node dist/migrate.js`, runs `up -d`, then smoke-tests `/healthz`.

```bash
curl https://<your-subdomain>.duckdns.org/healthz      # {"status":"ok"}
```

The first HTTPS request can take 10 to 30 seconds while Caddy obtains its certificate.

**Restarting by hand** (for example after editing `.env`) needs two things CI normally supplies:
the image owner, and a fresh image. Without them Compose looks for `ghcr.io/uposhom/...` and then
reuses a stale local `latest`:

```bash
cd /opt/uposhom
export GHCR_OWNER=<github-owner-in-lowercase>
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `usermod: group 'docker' does not exist` | Docker install did not finish. Re-run the get.docker.com script. |
| Deploy: `can't connect without a private SSH key or password` | A secret is empty, misspelled, or stored under Environments instead of Repository secrets. |
| Deploy: `unable to authenticate, attempted methods [none publickey]` | Key not in metadata (see 5b), wrong username in `PROD_SERVER_USER`, or the pasted private key is not the one matching the registered public key. On the VM: `sudo journalctl -u ssh --since "10 min ago" --no-pager`. |
| `docker compose pull` says `denied` / `unauthorized` | GHCR login missing or token expired (see 5d). |
| API container keeps restarting | `docker compose -f deploy/docker-compose.yml logs --tail=50 api`. Production refuses to boot if `APPLINK_CALLBACK_PATH_KEY` is empty. |
| HTTPS certificate error right after first deploy | Wait a minute; check `logs caddy`. Ports 80 and 443 must be open and the DNS name must resolve to the VM. |
| API cannot reach Postgres after changing the password | The volume still has the old password. Reset the volume or run `ALTER USER`. |

Useful commands on the VM:

```bash
cd /opt/uposhom
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs --tail=50 api caddy worker
docker compose -f deploy/docker-compose.yml up -d
```

## 7. Move the data from memory to Postgres

Until this is done, users, sessions, the SMS log and the billing ledger live in the API process and
are lost on every restart. Do it once, before real users:

```bash
cd /opt/uposhom
echo "PHONE_ENC_KEY=$(openssl rand -hex 32)" >> .env      # AES key for stored phone numbers
echo "STORE_DRIVER=postgres" >> .env
echo "QUEUE_DRIVER=pgboss"  >> .env
```

- **Back up `PHONE_ENC_KEY` in the password manager first.** Without it every stored number is
  unreadable and every lookup by number misses. Never change it after users exist.
- The API creates its tables on boot, and `node dist/migrate.js` (run by every deploy) does the same
  and is safe to repeat. pg-boss creates its own `pgboss` schema.
- Restart with the commands in section 6. Check `docker compose logs api` for
  `migrations checked`, then `/healthz`.
- Do both switches together: pg-boss replays unfinished jobs after a restart, and that is only safe
  once the SMS log and sessions survive restarts too.

## 8. Backups to Cloudflare R2

`deploy/backup.sh` dumps Postgres, encrypts it with AES-256 as it streams (an unencrypted copy
never touches the disk), uploads it to R2, checks the uploaded size, and prunes copies older than 14
days. `deploy/restore.sh` restores a backup into a scratch database, prints row counts, and drops it.

One-time setup on the VM:

```bash
sudo apt install -y rclone
# 1. The passphrase. Keep a copy in the password manager: a backup nobody can decrypt is worth nothing.
openssl rand -base64 32 > /opt/uposhom/backup.pass && chmod 600 /opt/uposhom/backup.pass
# 2. R2 credentials (Cloudflare dashboard: R2, create a bucket, then an Object Read & Write API
#    token scoped to that bucket only). Start from deploy/backup.env.example.
cp /opt/uposhom/deploy/backup.env.example /opt/uposhom/backup.env
nano /opt/uposhom/backup.env && chmod 600 /opt/uposhom/backup.env
# 3. Try it by hand, then schedule it for 02:00 Dhaka (20:00 UTC).
bash /opt/uposhom/deploy/backup.sh
( crontab -l 2>/dev/null; echo '0 20 * * * bash /opt/uposhom/deploy/backup.sh >> /var/log/uposhom-backup.log 2>&1' ) | crontab -
```

**Prove it restores, once, before the demo:**

```bash
bash /opt/uposhom/deploy/restore.sh /opt/uposhom/backups/<latest>.dump.enc
bash /opt/uposhom/deploy/restore.sh r2:backups/<latest>.dump.enc      # and from R2
```

You want `OK: the backup restores` and sensible row counts. The scripts are tested against a real
Postgres (encrypt, restore, wrong passphrase refused, loose permissions refused); the R2 upload step
needs your credentials, so run it by hand once and read the output.

## 9. When Applink's reply arrives

1. Put the credentials and the endpoint URLs in `/opt/uposhom/.env` (names are in `.env.example`:
   `APPLINK_APP_ID`, `APPLINK_PASSWORD`, `APPLINK_SMS_SEND_URL`, `APPLINK_SUBSCRIPTION_SEND_URL`,
   `APPLINK_SUBSCRIPTION_QUERY_BASE_URL`, `APPLINK_SUBSCRIPTION_CHARGING_INFO_URL`,
   `APPLINK_OTP_REQUEST_URL`, `APPLINK_OTP_VERIFY_URL`, and the two CaaS URLs, which must be set
   together or not at all), then restart (section 6).
2. Prove the connection first. Base Size costs nothing and touches no one, and it checks the
   credentials, the provisioning and the VM's egress IP in one call:
   ```bash
   docker compose -f deploy/docker-compose.yml exec api node dist/applink-smoke.js
   ```
   Each failure prints the next step (E1303: allow-list the VM's IP; E1313: check the credentials;
   E1309: ask Applink to enable the API).
3. Register the four callback URLs in the Applink portal (they carry the secret key; read it with
   `grep APPLINK_CALLBACK_PATH_KEY /opt/uposhom/.env`), then check they answer from outside:
   ```bash
   scripts/replay-callbacks.sh https://<your-domain> <callback-key>
   ```
4. Add the phones you will test with to Applink's whitelist, or every other number gets E1343.
5. When Applink sends its source IP ranges, restrict the callback paths in Caddy by adding to
   `/opt/uposhom/.env`: `APPLINK_ALLOWED_IPS=<range> <range> ...` (space separated), then
   `docker compose -f deploy/docker-compose.yml up -d caddy`. Unset it allows everyone, so nothing
   breaks until you know the list.
6. Optional but recommended: `ALERT_WEBHOOK_URL=<slack or discord incoming webhook>` so a wrong IP or
   bad credentials, a charge that needs a human, or a dead-lettered job reaches you.

## Still to add

- A free UptimeRobot HTTP monitor on `https://<domain>/healthz` (5 minute interval). It needs an
  account, so it cannot be scripted from here.
- Optionally a minimal service account for the VM instead of the default compute account.
