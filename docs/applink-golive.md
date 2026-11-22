# Applink go-live check

Run on 22 Nov 2026 against the `Ridwan` branch (workstream A). Method: Applink skill checklist
(`node tools/applink.mjs checklist`) and review practices (`node tools/applink.mjs practices`), each
item checked against the code, the tests or the running system. **PASS** means there is evidence.
**FAIL** means it is not done. **CANNOT VERIFY** means it depends on something outside the code
(Applink, the portal, the VM, another workstream). **N/A** means the feature is not used (USSD).

Nothing has been run against the real Applink platform: no credentials have been issued yet. Every
"tested" below means against the local mock, which checks each request body against the published
contract (`pnpm test:applink`).

## Verdict

**Not safe yet to put in front of real subscribers who can be charged real money.** The code is in
good shape and the money paths are covered by tests, but three things stand between this and real
charges: the integration has never touched the real platform; production still keeps accounts and
the charging ledger in memory (lost on restart); and the callback IP restriction is not set. The
FAIL and CANNOT VERIFY items below are ordered by risk at the end.

## 1. Credentials and configuration

| Item                                                                  | Result            | Evidence                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No `applicationId` / `password` in source, tests, fixtures or history | PASS              | Search of source, tests and CI: only fake fixtures (`APP_1`, `APP_MOCK`, `mock-not-a-real-password`). The two callback keys pasted in chat were searched in every revision: never committed.                                         |
| `.env` ignored; `.env.example` placeholders only                      | PASS              | `.gitignore` lines 7-10; `.env.example` holds blanks and placeholders                                                                                                                                                                |
| Secrets in the host's secret manager                                  | CANNOT VERIFY     | By design they live in `/opt/uposhom/.env` on the VM (chmod 600, never in the repo or CI) with a copy in the team password manager. Not a managed secret manager. Check the file's permissions on the VM.                            |
| Separate dev and production credentials                               | CANNOT VERIFY     | No credentials issued yet. Development uses the mock.                                                                                                                                                                                |
| Startup validation fails loudly                                       | PASS              | `apps/api/src/config/env.ts` and `env.test.ts`. Applink credentials are deliberately optional so the app boots before approval; production logs a warning when they are missing (`index.ts`) and every Applink feature fails closed. |
| No `NEXT_PUBLIC_` / `VITE_` / `EXPO_PUBLIC_` Applink variable         | PASS              | `apps/mobile` has no Applink variable; its comments state the app never calls Applink                                                                                                                                                |
| Base URL and paths from config                                        | PASS              | One endpoint variable per service (`applink.ts`); the only local-versus-live switch                                                                                                                                                  |
| Secret scanning in CI                                                 | PASS (configured) | gitleaks step in `.github/workflows/backend-ci.yml`. The result of its first run on this branch is not checked here.                                                                                                                 |
| Rotation procedure written and tested                                 | PASS (written)    | `docs/runbook.md`. The callback key was rotated once in practice. Rotating the Applink password is untested: CANNOT VERIFY.                                                                                                          |

## 2. Network

| Item                                                                              | Result        | Evidence                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Egress IP confirmed with `curl -4 https://api.ipify.org` on the production server | CANNOT VERIFY | Not run from here. Server logs show calls from the VM arriving as `35.209.167.137`. Run the command on the VM and compare.                                                           |
| That IP in Allowed Host Addresses in the portal                                   | CANNOT VERIFY | Portal access needed                                                                                                                                                                 |
| Egress IP static, survives redeploys                                              | CANNOT VERIFY | `deploy/README.md` reserves the address; the GCP console was not checked                                                                                                             |
| Callback URLs HTTPS with a complete chain                                         | PASS          | `https://uposhom.duckdns.org` answers `/healthz` and callbacks with a verified certificate (no `-k`)                                                                                 |
| Callback URLs stable                                                              | PASS          | Fixed domain and a fixed path key                                                                                                                                                    |
| Callback endpoints restricted to Applink source IPs                               | **FAIL**      | Built and verified with a real Caddy (allowed, blocked, unset) but `APPLINK_ALLOWED_IPS` is empty until Applink sends its ranges. Until then only the secret path key protects them. |
| Exempt from CSRF and auth middleware                                              | PASS          | Callbacks sit outside `authenticate`; the per-IP rate limit exempts them                                                                                                             |
| No bot protection or WAF in front                                                 | PASS          | Caddy is the only thing in front of the API                                                                                                                                          |
| TLS verification on                                                               | PASS          | No `rejectUnauthorized` or equivalent anywhere; the client refuses plain HTTP to a non-local host                                                                                    |

## 3. Correctness

| Item                                                                             | Result | Evidence                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch on `statusCode`, never the HTTP status                                    | PASS   | `packages/applink-client/src/client.ts` `post()`; no `res.ok` anywhere                                                                                                                                                              |
| `P1003` is pending, never a completed charge                                     | PASS   | `billing-caas.test.ts` (verify, notification, entitlement)                                                                                                                                                                          |
| Register and unregister decided on `subscriptionStatus`                          | PASS   | `subscriptions.ts`, `unregister.ts`, tests including the trailing-dot sample (`UNREGISTERED.`)                                                                                                                                      |
| No status code outside the published list                                        | PASS   | 25 codes used in source, all in the catalog                                                                                                                                                                                         |
| One `tel:` helper                                                                | PASS   | `toTelAddress` is the only place `tel:` is added                                                                                                                                                                                    |
| `destinationAddresses` always an array                                           | PASS   | `client.ts`; the mock validates it                                                                                                                                                                                                  |
| `subscriberId` treated as opaque                                                 | PASS   | Fixed during this review: `toTelAddress` used to strip `+` and spaces from ids Applink gave us. Stored ids now pass through unchanged and callback addresses are resolved to the stored id (`sms/identity.ts`, `identity.test.ts`). |
| USSD items (sessionId, mt-fin, shared store, ASCII)                              | N/A    | USSD is not used                                                                                                                                                                                                                    |
| Returning users authenticated by our own session                                 | PASS   | OTP only at sign-up and step-up; refresh needs no Applink call                                                                                                                                                                      |
| Entitlement read from the local mirror, no Applink call on a read path           | PASS   | `billing/subscriptions.ts`, `entitlements.ts`; read routes call no Applink method                                                                                                                                                   |
| Mirror records last confirmation, fed by notifications, reconciled on a schedule | PASS   | `subscriptions_mirror`; nightly sweep (`jobs/index.ts`)                                                                                                                                                                             |
| Explicit timeout on every outbound call                                          | PASS   | 10 seconds (`client.ts`), tested                                                                                                                                                                                                    |
| Retries only on transport errors and transient codes, with backoff and a cap     | PASS   | SMS retries only E1318/E1319/E1341/E1601/E1602/E1603, three times, doubling delay; money calls never retried (`sms.test.ts`, `billing-caas.test.ts`)                                                                                |

## 4. Callbacks

All four relevant callbacks are implemented (SMS receive, delivery report, subscriber notification,
charging notification). USSD is not used.

| Item                                                       | Result | Evidence                                                             |
| ---------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| Every handler returns `S1000`                              | PASS   | `scripts/replay-callbacks.sh` and `applink-callbacks.test.ts`        |
| Acknowledges before real work                              | PASS   | Handlers enqueue and return; the work runs on the queue              |
| Idempotent with a dedupe key                               | PASS   | Per-callback keys in `callbacks/events.ts`; duplicate tests for each |
| Validates the payload schema                               | PASS   | zod schemas in `callbacks/events.ts`                                 |
| Verifies `applicationId` where carried                     | PASS   | `routes/applink-callbacks.ts`; wrong-app test                        |
| Subscriber notification `password` redacted before logging | PASS   | Stripped on arrival; the PII audit finds it nowhere in the logs      |
| Malformed payloads acknowledged, not 500'd                 | PASS   | Also oversized, empty and wrong content type (`security.test.ts`)    |
| Duplicate-delivery test exists                             | PASS   |                                                                      |

## 5. Charging

| Item                                                          | Result        | Evidence                                                                                                                                                    |
| ------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `externalTrxId` unique and persisted before the first call    | PASS          | `caas.ts`; test asserts the order consent, ledger, Applink                                                                                                  |
| `requestCorrelator` persisted; charge fails closed without it | PASS          | `billing-caas.test.ts`                                                                                                                                      |
| `P1003` recorded as pending and the flow continues to verify  | PASS          |                                                                                                                                                             |
| A failed verification never re-runs generation                | PASS          | `startCharge` called once across retries (tested)                                                                                                           |
| `E1337` resolved from the notification, never a new id        | PASS          | Left `PROCESSING` (tested)                                                                                                                                  |
| `E1851` abandons rather than restarting                       | PASS          | Becomes `EXPIRED` (tested)                                                                                                                                  |
| Timeouts resolved by reconciliation, never by re-charging     | PASS          | Verify timeout leaves `PROCESSING`; job fails and alerts after two hours                                                                                    |
| `internalTrxId` stored                                        | PASS          |                                                                                                                                                             |
| Decimal money, currency BDT                                   | PASS          | Integer poisha in code, decimal strings on the wire; no float anywhere                                                                                      |
| Amount and currency server-side only                          | PASS          | The app sends a purpose; a test sends a price and it is ignored                                                                                             |
| Charged amount equals what was disclosed                      | CANNOT VERIFY | Server stores the price with each consent and returns it from `initiate`. The disclosure screen is in the app (workstream D) and must show the same figure. |
| `paidAmount` and `balanceDue` checked before fulfilment       | PASS          | Partial-then-full, short-paid, still-owed and non-numeric cases tested                                                                                      |
| Balance query unconfigured                                    | PASS          | Not implemented                                                                                                                                             |
| Reconciliation job                                            | PASS          | Every 10 minutes; closes unused codes, alerts on stuck payments                                                                                             |

## 6. Consent and compliance

| Item                                                             | Result        | Evidence                                                            |
| ---------------------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| Explicit opt-in recorded before every Register and every payment | PASS          | Tests assert the order                                              |
| Amount, currency, frequency disclosed before subscribing         | PASS (server) | Stored with the consent. The screen itself is D's.                  |
| Evidence stored: user, time, channel, wording                    | PASS          | `consents` table: wording, amount, currency, frequency, channel, IP |
| Opt-out in every channel                                         | PASS          | App button, SMS STOP/UNSUB/OFF. USSD not used.                      |
| Opt-out stops queued messages                                    | PASS          | Suppression checked at send time (`sms.test.ts`)                    |
| Never re-subscribed without fresh consent                        | PASS          | Only a recorded consent lifts a STOP; a block is never lifted       |
| `tel:all`                                                        | PASS          | The client refuses it; no broadcast feature exists                  |

## 7. Privacy

| Item                                                           | Result        | Evidence                                                                                                                                 |
| -------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Number masking enabled                                         | CANNOT VERIFY | A provisioning decision to settle with Applink (open question 3 in the plan)                                                             |
| `subscriberId` masked in logs                                  | PASS          | Last three digits only; the PII audit asserts it                                                                                         |
| Message bodies not logged or stored                            | PASS          | `sms_log` has no body column; audit                                                                                                      |
| OTP, `referenceNo`, `requestCorrelator`, password never logged | PASS          | `security.test.ts` runs a whole session and searches every log line                                                                      |
| MSISDNs encrypted at rest                                      | PASS (code)   | AES-256-GCM plus a keyed lookup hash. **Today production still holds users in memory**, so nothing is persisted yet (see the FAIL list). |
| Retention defined and enforced                                 | PASS          | `ops/retention.ts`, nightly purge, contract-tested on both stores                                                                        |
| Data deleted or anonymised on unsubscribe                      | PASS          | `DELETE /api/v1/account` (step-up required) erases the Applink-side data, anonymises charges and keeps only a STOP entry                 |

## 8. Operations

| Item                                                    | Result           | Evidence                                                                                                                            |
| ------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Identifiers logged on every operation                   | PASS             | `requestId`, `externalTrxId`, `internalTrxId`, `statusCode`, `type`                                                                 |
| Alert on E1303, E1313, E1309                            | PASS (code)      | `onError` hook to a Slack/Discord webhook. Needs `ALERT_WEBHOOK_URL` set: CANNOT VERIFY delivery.                                   |
| Dashboard for volume, delivery, success rate, base size | **FAIL**         | None built. The numbers are in the logs and the database only.                                                                      |
| Base Size polled on a schedule                          | PASS             | Hourly job; failures alert                                                                                                          |
| Dead-letter queue                                       | PASS             | pg-boss dead-letter queue, reviewed by a daily job that alerts                                                                      |
| TPS/TPD limits known and respected by a throttle        | PASS (mechanism) | `SMS_MAX_PER_SECOND` spacing, backoff on E1318, alert on E1319. The actual limits are unknown until Applink answers: CANNOT VERIFY. |
| Runbook (E1303, E1313, stuck charge, dispute)           | PASS             | `docs/runbook.md`                                                                                                                   |
| A named owner of the Applink account                    | CANNOT VERIFY    | The names table in the runbook is blank                                                                                             |

## 9. Testing

| Item                                                              | Result        | Evidence                                                                    |
| ----------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------- |
| Every endpoint smoke-tested against Limited Production            | CANNOT VERIFY | No credentials yet. `pnpm applink:smoke` is ready for the first call.       |
| Full end-to-end on the real platform                              | CANNOT VERIFY | Done on the mock (`billing-mock.test.ts`) and on PostgreSQL, not on Applink |
| Opt-out tested end to end                                         | PASS (mock)   | SMS STOP and the app opt-out                                                |
| Callbacks with valid, malformed, wrong-app and duplicate payloads | PASS          |                                                                             |
| Failure paths E1313, E1303, E1326, E1850, E1851, timeout          | PASS (mock)   | `ops.test.ts`, `smoke.test.ts`, `billing-caas.test.ts`                      |
| Load tested to the per-second ceiling                             | **FAIL**      | Not done; needs Applink's limit                                             |
| Tested from the production egress IP                              | CANNOT VERIFY | `dc exec api node dist/applink-smoke.js` on the VM                          |

## Before requesting approval

| Item                                          | Result             | Evidence                                                                                                     |
| --------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Portal description accurate                   | CANNOT VERIFY      | Portal text is written by the team                                                                           |
| Charging amounts defensible                   | CANNOT VERIFY      | Placeholders until decided with the mentor                                                                   |
| Terms of service and privacy policy reachable | PASS, with caveats | `/legal/terms`, `/legal/privacy`. Two bracketed placeholders must be removed first (`docs/legal-review.md`). |
| Support contact published                     | **FAIL**           | `SUPPORT_EMAIL` and `SUPPORT_PHONE` are unset                                                                |
| Limited Production testing done               | CANNOT VERIFY      |                                                                                                              |
| Content governance and advertisement settings | CANNOT VERIFY      | Portal settings                                                                                              |

## What blocks real charges, in order of risk

1. **Never exercised against the real platform (CANNOT VERIFY).** The mock returns the published
   samples. Real response shapes, especially for the CaaS verify call (the published sample echoes
   the request), and which address form callbacks use, are unproven. Run `applink-smoke`, then one
   whitelisted end-to-end payment, before anything else.
2. **Production state is in memory (FAIL).** Until `STORE_DRIVER=postgres` and `QUEUE_DRIVER=pgboss`
   are set (`deploy/README.md` section 7), a restart forgets accounts, consents, the charging ledger
   and queued jobs. **Do not enable Subscription or CaaS in production before this.**
3. **Callbacks are not IP-restricted (FAIL).** Ask Applink for its ranges, set `APPLINK_ALLOWED_IPS`.
4. **Prices are placeholders (CANNOT VERIFY),** and the app's disclosure must show exactly the price
   the server charges.
5. **No support contact; legal pages contain placeholders (FAIL).** Applink checks both.
6. **Owner names, alert webhook, backups to R2 not yet set up (CANNOT VERIFY).** Operations cannot
   respond to an alert nobody receives.
7. **No dashboard and no load test (FAIL).** Lower risk; do before a large rollout.
