# apps/mobile

Uposhom (উপশম) Android app: Expo (development build), Expo Router, NativeWind, TypeScript, minSdk 26.
Owned by workstream **D**.

## Run

```bash
pnpm install                       # from the repo root
pnpm --filter @uposhom/mobile start   # Metro for a development build
pnpm --filter @uposhom/mobile android # build and run on a connected device or emulator
```

Notifee, the camera and exact alarms are native modules, so a **development build** is needed (Expo Go will not work).

## Mock mode and the live API

The app talks only to our own backend (`/api/v1/...`), never to Applink, and holds no Applink secret.

- With **no** `EXPO_PUBLIC_API_URL`, the app serves seeded **synthetic** data from `src/api/mock/` so every screen runs before the live endpoints land.
- Set `EXPO_PUBLIC_API_URL=https://<api-domain>` (and optionally `EXPO_PUBLIC_USE_MOCK=0`) to use the real server. **Set it in CI for any APK you hand to others**, otherwise the APK runs on mock data.

Mock sign-in: any valid mobile number, OTP `123456`. Number endings `1111` / `9999` / `0000` / `5555` show the four sign-up error states. `01700000099` is a Premium demo account with three profiles, alerts and agent traces.

Request and response shapes live in `packages/shared` (zod). Fields marked "proposed" there are additions the app needs and must be confirmed with A, B and C.

## Checks

```bash
pnpm --filter @uposhom/mobile typecheck
pnpm --filter @uposhom/mobile lint
pnpm --filter @uposhom/mobile test
pnpm --filter @uposhom/mobile export:check   # full Android Metro bundle
```

## Push notifications

Caregiver push needs FCM credentials: set `GOOGLE_SERVICES_JSON` to the path of `google-services.json` at build time. Without it the app still works and SMS carries the alert.

## Status

Day 0 and Day 1 scope: shell, theme, shared `<Text>`, API client and mock, auth, Family Circle, camera capture, side-by-side confirm, profile management, Notifee reminder module, offline cache. Later-day screens (alerts, Premium, settings, symptoms, voice, pharmacy account, admin traces) are placeholders (`ComingSoon`).
