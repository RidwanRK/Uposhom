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

cat > /opt/uposhom/.env <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

API_DOMAIN=<your-subdomain>.duckdns.org

POSTGRES_USER=uposhom
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=uposhom
DATABASE_URL=postgres://uposhom:${PG_PASS}@postgres:5432/uposhom

APPLINK_APP_ID=
APPLINK_PASSWORD=
APPLINK_CALLBACK_PATH_KEY=${CB_KEY}
EOF

chmod 600 /opt/uposhom/.env
unset PG_PASS CB_KEY
```

Notes:

- Set `POSTGRES_PASSWORD` **before the first start**. Postgres only reads it when it creates the data
  volume; changing it later does not change the database user.
- Store the Postgres password and `APPLINK_CALLBACK_PATH_KEY` in the password manager. The callback key
  is part of the five URLs registered with Applink and must stay stable.
- `APPLINK_APP_ID` and `APPLINK_PASSWORD` arrive by email after Applink approves the application. Add
  them with `nano /opt/uposhom/.env`, then `cd /opt/uposhom && docker compose -f deploy/docker-compose.yml up -d`.
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

## Still to add

- Scheduled Postgres backup to Cloudflare R2 (cron on the VM). Not set up yet; until then the only copy of the data is the VM disk.
- Applink source-IP restriction in the Caddyfile once Applink publishes its ranges.
- Optionally a minimal service account for the VM instead of the default compute account.
