# Expense Capture React Native App

Android-only React Native client for automatic UPI capture without MacroDroid.

## Features

- Notification listener capture (primary)
- SMS fallback capture
- HMAC-signed ingestion to your backend (`/api/ingest/mobile`)
- Offline queue + retry flush
- In-app setup for URL, user UUID, secret, and filters

## Stack

- Expo + React Native
- `react-native-android-notification-listener`
- `react-native-sms-receiver`
- `@react-native-async-storage/async-storage`

## Important

This app uses native Android modules, so **Expo Go is not enough**.
Use an EAS development/preview build.
Also, pressing `a` in Expo CLI needs local Android SDK + `adb`.

## Run without Android Studio / adb (recommended)

1. Install the development APK built from EAS/GitHub workflow on your phone.
2. Start Metro in tunnel mode:
   ```bash
   cd mobile-capture-rn
   npm run start
   ```
3. Open the installed **Expense Capture** dev build on your phone.
4. Scan the QR code shown in terminal.

Do not use `a` / `expo run:android` on this machine unless Android SDK + `adb` is installed.

## Cloud build (no Android Studio)

1. Create Expo account and get token.
2. Set repository secret `EXPO_TOKEN` in GitHub.
3. Set `mobile-capture-rn/app.json` -> `extra.eas.projectId`.
4. Push to `main` and run workflow: `.github/workflows/mobile-rn-cloud-build.yml`.
5. Download APK build URL from workflow logs.

## Runtime setup in app

- Backend URL: `https://<your-domain>`
- User UUID: your linked profile `user_id`
- Secret: same as backend `MOBILE_INGEST_SECRET`
- Notification app filters: package ids
- SMS sender filters: bank sender ids

## Recommended notification package filters

- `com.google.android.apps.nbu.paisa.user`
- `com.phonepe.app`
- `net.one97.paytm`
- plus your bank apps
