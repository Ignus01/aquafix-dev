# AquaFix Capture (mobile)

The native, offline-first field app from `dev/spec/AquaFix Capture App Spec.md`. It copies the `/m` PWA's six tiles (Inspections, Incidents, Instructions, Services, Location Status, Stock), works with no signal, and syncs when it gets one.

Expo SDK 58, React Native 0.88, TypeScript, Expo Router, PowerSync (`@powersync/react-native` on `@op-engineering/op-sqlite` with SQLCipher), Supabase Auth, Storage and RPCs.

## How it works

- **Screens read and write only the local SQLite database.** Nothing on a screen waits for the network.
- **Down:** PowerSync fills SQLite from the Sync Streams in `powersync/sync-config.yaml` (every stream has `auto_subscribe: true`).
- **Up:** each Save is one write transaction. It writes the local rows (so lists update at once) and one row in the insert-only `outbox` table holding the RPC command. `SupabaseConnector.uploadData()` (`src/sync/connector.ts`) takes the transactions in order. It uploads the command's photos (upsert off; 409 counts as uploaded), then calls the RPC:
  - **Success:** the transaction completes.
  - **No network, timeout, 5xx, 408, 429 or expired JWT:** it throws, and PowerSync retries the transaction later.
  - **Anything else, including `ok:false`:** the command is copied to `needs_attention`, and the transaction completes so the queue keeps moving.
- **Validation:** `src/domain/validation.ts` is the TypeScript port of `save_inspection_activity` sections A–D, plus grading and display values. `validation.test.ts` runs the pgTAP golden cases (T1–T16, V8, edit, A5 cut-off) against it.
- **Photos:** each photo is resized to 1,600 px / 0.82 plus a 400 px / 0.72 thumbnail and kept in app storage (`photo_file`). It is uploaded to `<bucket>/<uid>/<photo id>.jpg` before its save. After each sync the app downloads missing thumbnails through 1-hour signed URLs. Full-size images are fetched only when opened.
- **Security:**
  - The session lives in the Keychain/Keystore (chunked `expo-secure-store`).
  - The SQLite key is random per install and also kept in the Keychain/Keystore.
  - Sign-out is refused while anything waits to upload, and wipes the phone after.

## Layout

| Path | What |
| --- | --- |
| `src/app/` | Routes (Expo Router), one per PWA screen, plus `attention/` (Needs attention) and `reauth` |
| `src/domain/` | Pure logic with unit tests: validation, dates in the app time zone, roles, upload error rule, min version |
| `src/commands/` | The five commands: local writes + outbox row per Save (`inspection.ts`, `incident.ts`, `stock.ts`) |
| `src/sync/` | Connector (`fetchCredentials`, `uploadData`), photo upload/cache, sync lifecycle and sign-out |
| `src/db/` | PowerSync client schema (`schema.ts`) and the encrypted database |
| `src/ui/` | Components styled like `web/src/app/m/ui.tsx` |

## Setup

Requires **Node 22.13+** (React Native 0.88 refuses older; Node 20 prints engine warnings). Also requires a development build, because Expo Go can't load op-sqlite.

```bash
cd mobile
npm install
cp .env.example .env   # fill in (see the spec's "Developer hand-off")
npx expo run:android   # or run:ios — builds a development client
```

Local development follows the spec: local Supabase (`npx supabase start`), self-hosted PowerSync Open Edition in Docker loading `powersync/sync-config.yaml`, and the phone pointing at the laptop's LAN IP (emulator: `10.0.2.2`). With `APP_ENV=development`, the build allows plain http; staging and production builds are https only.

Test APK (staging values in `.env`, `APP_ENV=staging`):

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

Checks:

```bash
npm test            # vitest: validation golden cases and helpers
npm run typecheck
npx eslint src
```

## Assumptions to review

These were decided without asking, per the brief.

**Backend**
1. **Backend branch merged in.** This branch was fast-forwarded onto `claude/aquafix-offline-first-app-82b2bd` (migrations 20261104120000–170000), because the app calls those RPC signatures. Nothing was pushed or deployed.

**Scope**
2. **All three milestones are built** (Inspections/Instructions, Incidents/Location Status/Services, Stock). Nothing hides the later tiles; the spec's "hide tiles until their APK" was not wired. A flag can be added before handing out APK 1.

**Inspection saves**
3. **C5 auto-incidents only travel with a successful save.** The PWA commits an auto-incident even when the save then fails [AS-IS, V6]. The phone queues nothing when local validation fails, so the incident is created when the corrected save uploads (once, not twice). The phone also shows a local copy at once, which the server's row replaces.
4. **Fixing a Needs attention item uses the time of the fix.** Re-saving sends `captured_at` = now, so `inspection_date` becomes the time of the fix (it's a new command). Phone ids are reused for inspections and incidents (a raised rejection writes nothing). Stock documents get new ids, to avoid "This document… was already saved".
5. **"Save as ad-hoc"** shows on an inspection whose instruction was "already Inspected". It drops the instruction after a confirmation.

**Lists and data**
6. **Incidents list:** completed incidents show only when they are mine and completed in the last 7 days (the spec's window). The PWA uses "created today".
7. **Timestamps** from sync may arrive as `YYYY-MM-DD HH:MM:SS.sssZ`. All comparisons use SQLite `julianday()`, and parsing goes through `toDate()`.

**App behaviour**
8. **App ids and identity:**
   - App ids are `co.aquafix.capture[.staging|.development]`, with a minimum of Android 10 (SDK 29) and iOS 16.4.
   - Re-signing in after the session expires must use the same account. One inspector per phone.
9. **Background uploads are not built.** Uploads run while the app is open. The spec's "runs in the background on both platforms" needs a background task (for example `expo-background-task`), which isn't wired yet.
10. **Waiting-to-upload count** on Home counts distinct transactions in PowerSync's internal `ps_crud` table. If that ever fails, it falls back to `getUploadQueueStats()`.
11. **Sentry** is wired but off until `EXPO_PUBLIC_SENTRY_DSN` is set. It logs the command name and error code only; `organization`/`project` for source maps are not configured.

## Not verified yet

- The app has not been run on a device or emulator. Verified so far:
  - type check and ESLint pass
  - 34 unit tests pass
  - a full Android Metro/Hermes bundle builds (`npx expo export --platform android`)
  - `expo-doctor` passes 20/20
- Still to run against a real backend: the acceptance checklist in the spec (first sync, airplane-mode captures, upload order, kill mid-upload, conflict cases, midnight drop-off, sign-out wipe, min version).
