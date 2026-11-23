# apps/mobile

Uposhom (উপশম) Android app: Expo (development build), Expo Router, NativeWind, TypeScript, minSdk 26.
Owned by workstream **D**.

## Run

```bash
pnpm install                          # from the repo root
pnpm --filter @uposhom/mobile start   # Metro for a development build
pnpm --filter @uposhom/mobile android # build and run on a connected device or emulator
```

Notifee, the camera, exact alarms and audio recording are native modules, so a **development build** is
needed (Expo Go will not work).

## Three ways to run it

| Mode                     | How                                                                                      | What answers                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Mock**                 | no `EXPO_PUBLIC_API_URL`                                                                 | everything, from seeded synthetic data inside the app (`src/api/mock/`)              |
| **Live (local backend)** | `pnpm dev:local`, then `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 EXPO_PUBLIC_USE_MOCK=0` | the real API; the few endpoints it does not serve yet fall back to the mock (hybrid) |
| **Live (deployed)**      | `EXPO_PUBLIC_API_URL=https://<api-domain>`                                               | same as above against the VM                                                         |

On an emulator the computer is `http://10.0.2.2:3000`; on a phone use the computer's Wi-Fi address. The
app adds `/api/v1` itself. See `docs/local-backend.md`.

**Set `EXPO_PUBLIC_API_URL` in CI for any APK you hand to others**, otherwise it runs on mock data.

### Hybrid mode

Every endpoint the app calls is served by the API now, except Family Link (`profiles/:id/link/*`),
which is still answered by the in-app mock while a live API is configured (`MISSING_ON_SERVER` in
`src/api/config.ts`). Delete that line once the server serves it, or set `EXPO_PUBLIC_MOCK_MISSING=0`.

The AI endpoints (scans, reports, journal, voice, insights) answer with workstream C's built-in samples
when the server has no `OPENROUTER_API_KEY`, so they work against `pnpm dev:local` too. If `voice/query`
fails, the voice screen still answers from today's doses on the phone.

Mock sign-in: any valid mobile number, OTP `123456`. Number endings `1111` / `9999` / `0000` / `5555` show
the four sign-up error states. `01700000099` is a Premium demo account with three profiles, alerts and
agent traces.

## Checks

```bash
pnpm --filter @uposhom/mobile typecheck
pnpm --filter @uposhom/mobile lint
pnpm --filter @uposhom/mobile test
pnpm --filter @uposhom/mobile export:check   # full Android Metro bundle
pnpm --filter @uposhom/mobile smoke:live     # 30 calls against a running `pnpm dev:local`, checked against the zod contracts
```

`EXPO_WEB_PREVIEW=1 EXPO_PUBLIC_USE_MOCK=1 npx expo start --web` adds a web target purely so the UI can be
looked at in a browser. Notifee, the camera and exact alarms do not run there.

## Push notifications

Caregiver push needs FCM credentials: set `GOOGLE_SERVICES_JSON` to the path of `google-services.json` at
build time. Without it the app still works and SMS carries the alert.

## What is not verified yet

Nothing here has run on a real phone: Notifee exact alarms with the app closed and after a reboot, the
camera, audio recording, text-to-speech and the PDF share sheet all need a device test (Master Plan
section 17 D). The support contact in `src/i18n/bn.ts` is a placeholder until the real one is decided.
