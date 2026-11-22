# Running the backend on your own machine (no Applink needed)

For B, C and D: you do not need Applink's approval, credentials or a phone to build and test against
the real backend.

```bash
pnpm install
pnpm dev:local
```

That starts the Applink mock and the real API pointed at it. Data is kept in memory and forgotten on
restart.

| What         | Where / how                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API          | `http://localhost:3000` (set `PORT` to change). Try `/healthz` and `/legal/terms`.                                                                                                                                                                                 |
| Sign-up      | `POST /api/v1/auth/otp/request` then `/otp/verify`. **Any 4 to 8 digit code passes.**                                                                                                                                                                              |
| Fake Applink | `http://127.0.0.1:8090` (a small proxy in front of the mock on 8089)                                                                                                                                                                                               |
| Payments     | After `POST /api/v1/billing/caas/verify`, a "paid in full" charging notification is sent for you one second later, so the charge goes `PENDING` then `SETTLED` and the credit appears. `DEV_AUTO_SETTLE=0 pnpm dev:local` turns that off so you can post your own. |
| Subscription | `POST /api/v1/billing/subscription/subscribe` activates Premium straight away.                                                                                                                                                                                     |

Contracts are the zod schemas in `packages/shared`; the paths the app calls are in
`apps/mobile/src/api/endpoints.ts`.

## What it cannot do

- **One phone number at a time.** The mock answers every OTP verify with the same subscriber id, so a
  second number signs in as the same subscriber.
- **No real SMS or OTP delivery.** Messages go to the mock, which only checks they are well formed.
  `curl http://127.0.0.1:8089/__report` lists every request it has seen and whether it was valid.
- **Replies by SMS** are simulated by posting to the callback yourself:
  ```bash
  curl -X POST http://localhost:3000/api/applink/sms/receive -H 'content-type: application/json' \
    -d '{"sourceAddress":"tel:8801416177301","message":"UPOSHOM 1","requestId":"r1"}'
  ```
  (`tel:8801416177301` is the subscriber id the mock hands out at sign-up.)

## For workstream B (domain, engine, reminders)

- Send an SMS with `app.services.sms.enqueue({ subscriberId, message, purpose, idempotencyKey })`. It
  is queued, never sent twice, skipped for numbers that said STOP, and logged without the text.
- Before doing work that is limited by plan, call `app.services.entitlements.useScan(userId)`,
  `useSms(userId)` or `useFeature(userId, 'DOCTOR_SUMMARY')` and branch on `allowed`.
- Fill in the hooks in `apps/api/src/ports.ts` (`doseReply`, `onSmsDeliveryFailure`,
  `eraseDomainData`) and pass them as `ports` to `buildApp`.
- Users live in the `users` table with text ids such as `usr_9f2c...`; reference `users(id)` from your
  tables. The Applink-side tables are plain SQL migrations in `apps/api/src/db/migrations.ts`, applied
  by `node dist/migrate.js`. When your Drizzle setup lands, tell A how you want the two to meet:
  either adopt those files as your first migrations or keep both runners side by side.

## For workstream C (AI)

SMS free-text questions are not routed to the AI yet: an inbound message that is not a reply code or
STOP gets a one-line usage hint. When the triage agent is ready, ask A to add a `freeTextQuestion`
hook next to `doseReply` in `ports.ts`, so the answer goes out through the same SMS queue.

## For workstream D (mobile)

The app can talk to the real backend now instead of its own mock. While `pnpm dev:local` is running,
start the app with:

```bash
EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-address>:3000 EXPO_PUBLIC_USE_MOCK=0 npx expo start
```

The app adds `/api/v1` itself, so do **not** put it in the URL. On the Android emulator the computer
is `http://10.0.2.2:3000`; on a real phone use the computer's address on your Wi-Fi (the phone and the
computer must be on the same network). The deployed VM returns `SERVICE_TROUBLE` for sign-up until
Applink issues credentials, so use the local stack for anything that needs a signed-in user.

### Domain endpoints that are live (workstream B)

These answer from the real backend now, with the same shapes as `packages/shared`:

| Endpoint                              | Notes                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /circles`                        | The first call creates the circle and the user's own profile (`relationship: SELF`).                                                                                                         |
| `POST /profiles`, `PUT /profiles/:id` | Free allows only the own profile: adding one answers `402 PAYMENT_REQUIRED` with message `PREMIUM`. Meal times must run morning < noon < evening < night (`400`, message `MEAL_TIME_ORDER`). |
| `POST /prescriptions/:id/confirm`     | Use `new` as the id for a typed-in prescription. Items the engine cannot schedule exactly answer `422 NEEDS_MANUAL_INPUT` with `details: [{ index, reasons }]`, and nothing is saved.        |
| `GET /doses/today?profileId=&days=`   | From today's midnight in Dhaka for `days` days (1 to 14). A snoozed dose keeps its `dueAt` and has `snoozedUntil`.                                                                           |
| `POST /doses/:id/action`              | `409 DOSE_NOT_DUE` more than 2 hours before the dose, `409 DOSE_CLOSED` once taken or skipped. Send `X-Action-Source: notification` from Notifee buttons.                                    |

SMS replies (`UPOSHOM 1`, `2`, `3`) act on the latest dose due in the last 6 hours, through the same rules.
