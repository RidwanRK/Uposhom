# Uposhom operations runbook

For whoever is on call for the platform and the Applink integration. Commands run on the VM in
`/opt/uposhom` unless stated. Placeholders look like `<this>`. **Never paste real keys, tokens,
passwords or phone numbers into chats, tickets or commits.**

```bash
cd /opt/uposhom
export GHCR_OWNER=<github-owner-lowercase>           # needed for any manual docker compose command
alias dc='docker compose -f deploy/docker-compose.yml'
```

## First, check it is up

```bash
curl -s https://<domain>/healthz            # {"status":"ok"}
dc ps                                       # api, worker, postgres, caddy all Up
dc logs --tail=50 api | grep -E "rror|warn"
dc exec api node dist/applink-smoke.js      # Base Size: proves credentials, provisioning, egress IP
```

## Applink errors

| Code      | What it means                                     | What to do                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **E1303** | The IP this request came from is not allow-listed | On the VM run `curl -4 https://api.ipify.org`. If it differs from the address in the Applink portal's allowed host addresses, add it. Never recreate the VM or its reserved IP without telling Applink. The platform alerts on this one (`applink-configuration-error`). |
| **E1313** | Authentication failed                             | Check `APPLINK_APP_ID` and `APPLINK_PASSWORD` in `.env` (no spaces or quotes), that you used the right environment's credentials, and that the application is active in the portal. Then `dc up -d api` and run the smoke test.                                          |
| **E1309** | The API is not provisioned for this application   | A portal fix, not a code fix: ask Applink support to enable it.                                                                                                                                                                                                          |
| **E1343** | Number not whitelisted                            | Limited Production only. Add the number in the portal. It looks like "nothing happened".                                                                                                                                                                                 |
| **E1318** | Per-second limit exceeded                         | The send queue retries with backoff. Set `SMS_MAX_PER_SECOND` in `.env` to the figure Applink gives you so sends are spaced out, then `dc up -d api`.                                                                                                                    |
| **E1319** | Per-day limit exceeded                            | Retrying will not clear it today. The platform alerts (`applink-daily-sms-limit`). Ask Applink to raise the ceiling; unsent reminders fail and are not replayed automatically.                                                                                           |
| **E1342** | The number is blacklisted                         | The number is blocked permanently by us (no further messages). Nothing to retry.                                                                                                                                                                                         |
| **E1317** | Number invalid or not served                      | Shown to the user as "number cannot be used". If many users on other networks hit it, raise it with Applink (open question: do OTP and SMS reach other operators?).                                                                                                      |

Alerts go to `ALERT_WEBHOOK_URL` (Slack or Discord). Without it they exist only in the logs.

## A charge is stuck

A charge is two Applink calls and a callback. **Only the charging notification settles it.** Never
re-run "start charge" to retry a verification, and never issue a new `externalTrxId` for the same
payment: either one starts a second charge.

Look it up (the ledger is the `charges` table):

```bash
dc exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
 "select external_trx_id, status, amount, purpose, internal_trx_id, paid_amount, balance_due,
         created_at, updated_at from charges order by created_at desc limit 20;"
```

| Status                                     | Meaning                                                         | Action                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING` / `OTP_SENT` for over 10 minutes | The person never entered the code. **Nothing was charged.**     | None: the reconciliation job (every 10 minutes) closes it as `EXPIRED`.                                                                                                                       |
| `PROCESSING`                               | Verify was submitted, the charging notification has not arrived | Wait. After 2 hours the job marks it `FAILED` **and alerts** (`charge-stuck <id>`).                                                                                                           |
| `PARTIAL`                                  | A partial payment notification arrived                          | Wait for the rest. After 2 hours it is failed and alerted like `PROCESSING`.                                                                                                                  |
| `FAILED` after an alert                    | Submitted but never confirmed. **Money may have moved.**        | Ask Applink support for the transaction by `internal_trx_id`. If it was charged, grant the credit by hand (see below). If not, nothing to do. Never refund or grant without Applink's answer. |
| `SETTLED`                                  | Paid in full, entitlement released                              | None.                                                                                                                                                                                         |

Grant a credit by hand after Applink confirms a charge was taken (one credit per charge, enforced by
the database, so running it twice is safe):

```bash
dc exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
 "insert into entitlements (id, user_id, feature, quantity, granted_by_charge, created_at)
  select gen_random_uuid(), user_id, purpose, 1, external_trx_id, now()
  from charges where external_trx_id = '<external_trx_id>' and user_id is not null
  on conflict (granted_by_charge) do nothing;
  update charges set status='SETTLED', fulfilled_at=now(), updated_at=now()
  where external_trx_id = '<external_trx_id>';"
```

### A charging dispute

1. Ask for the date, amount and which feature. Find the charge by user (you cannot search by phone
   number: numbers are encrypted) from the app's account, or by `external_trx_id` if they have it.
2. Read `status`, `paid_amount`, `balance_due`, `internal_trx_id`, `created_at`.
3. Consent evidence for that payment is in `consents` (`kind` like `CAAS_DOCTOR_SUMMARY_V1`: the
   wording shown, the amount and the time).
4. Send Applink the `internal_trx_id` and the time. Do not promise a refund before they answer.
5. After an account is erased its charges stay but are anonymous (`user_id` null, subscriber
   `erased`): you can still check the money, not who paid.

## A person says they get no reminders

```bash
dc exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
 "select status, delivery_status, applink_status_code, purpose, created_at
  from sms_log where subscriber_id = '<subscriber id>' order by created_at desc limit 10;
  select * from sms_opt_outs where subscriber_id = '<subscriber id>';"
```

- A row in `sms_opt_outs`: reason `STOP` (they opted out: a fresh consent in the app lifts it),
  `DEAD_NUMBER` (three undeliverable messages in a row) or `BLOCKED` (Applink blacklisted it).
- `status = FAILED` with `E1343`: not whitelisted (Limited Production).
- `status = UNKNOWN`: a timeout, so we do not know. The delivery report decides.

## Jobs that failed (dead letters)

Failed jobs go to the pg-boss dead-letter queue and are reviewed daily (an alert says how many).

```bash
dc exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
 "select id, state, retry_count, created_on, left(data::text, 200) as data
  from pgboss.job where name = 'dead-letter' order by created_on desc limit 20;"
```

Read what failed in `dc logs api`, fix the cause, then re-enqueue by hand if it still matters. Do not
bulk-replay SMS or charges: check each against `sms_log` and `charges` first.

## Rotating secrets

| Secret                                         | How                                                                                                                                                                               | Effect                                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Applink password** (`APPLINK_PASSWORD`)      | The Applink account owner logs in to the portal and issues a new key. Put it in `.env`, `dc up -d api`, run `dc exec api node dist/applink-smoke.js`.                             | Calls with the old key fail with E1313 from the moment Applink switches it: do the two steps together.                                                               |
| **Callback key** (`APPLINK_CALLBACK_PATH_KEY`) | `sed -i "s/^APPLINK_CALLBACK_PATH_KEY=.*/APPLINK_CALLBACK_PATH_KEY=$(openssl rand -hex 24)/" .env`, `dc up -d api`, then **update all four callback URLs in the Applink portal**. | Until the portal is updated Applink posts to dead URLs. Tested once in practice (old key returned 404, new key 200). Prefer rotating before the URLs are registered. |
| **JWT secret** (`JWT_SECRET`)                  | New value in `.env`, `dc up -d api`.                                                                                                                                              | Access tokens (15 minutes) stop working; refresh tokens survive, so people are not asked for an OTP.                                                                 |
| **Phone encryption key** (`PHONE_ENC_KEY`)     | **Do not rotate.**                                                                                                                                                                | Every stored number becomes unreadable and every lookup by number misses. Needs a re-encryption migration first. Back it up.                                         |
| **Backup passphrase**                          | New file, keep the old one to read old backups.                                                                                                                                   | Old backups need the old passphrase.                                                                                                                                 |
| **Deploy SSH key**                             | New key, register it in the VM's instance metadata (not `authorized_keys`), update the `PROD_SSH_PRIVATE_KEY` secret.                                                             | See `deploy/README.md` section 5.                                                                                                                                    |
| **Database password**                          | `ALTER USER` inside Postgres **and** `.env`, together.                                                                                                                            | Changing only `.env` does not change the database user.                                                                                                              |

If a key may have leaked (pasted in a chat, shown in a log, committed): rotate it. For the callback
key, an attacker can only post fake callbacks; the code ignores anything it does not recognise, and
the Caddy IP restriction (`APPLINK_ALLOWED_IPS`) closes that door entirely once Applink sends its
ranges.

## Backups

See `deploy/README.md` section 8. Nightly at 02:00 Dhaka, encrypted, to Cloudflare R2. A backup is
only real once restored: run `bash deploy/restore.sh <file>` before the demo and again after any
change to the schema.

## Who owns what

Fill these in before registering with Applink. A runbook with no names does not get followed.

| Role                                                                      | Name | Contact |
| ------------------------------------------------------------------------- | ---- | ------- |
| Owns the Applink account (can log in to the portal to rotate credentials) |      |         |
| On call for the platform and Applink integration                          |      |         |
| Owns the VM and the Cloudflare R2 account                                 |      |         |
| Contact at Applink support (`support@applink.com.bd`)                     |      |         |
