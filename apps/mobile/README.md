# apps/mobile

Placeholder owned by **D** (Product Mobile & UI). Replace `package.json` with the real Expo project
(development build, Expo Router, NativeWind, TypeScript, minSdk 26).

`.github/workflows/mobile-ci.yml` skips the APK build until `app.config.ts` (or `app.json`) exists
in this folder. Once it does, pushing the tag `v0.1-skeleton` publishes
`uposhom-v0.1-skeleton.apk` as a public GitHub Release asset.

Requirements for the CI build to work:

- package name `@uposhom/mobile`, with `typecheck`, `lint` and `test` scripts
- `.npmrc` at the repo root already sets `node-linker=hoisted` for Metro
