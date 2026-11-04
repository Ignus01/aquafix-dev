// Expo config. APP_ENV (development | staging | production) picks the app id
// and whether plain-http LAN hosts are allowed (development builds only, for
// a local Supabase and self-hosted PowerSync; staging and production stay
// https only). All URLs and keys come from mobile/.env (see .env.example).
import type { ConfigContext, ExpoConfig } from "expo/config";

const APP_ENV = process.env.APP_ENV ?? "development";
const isDev = APP_ENV === "development";
const suffix = APP_ENV === "production" ? "" : `.${APP_ENV}`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_ENV === "production" ? "AquaFix Capture" : `AquaFix Capture (${APP_ENV})`,
  slug: "aquafix-capture",
  scheme: "aquafix-capture",
  // Semantic version: shown on the home screen and compared with
  // mobile_app_config.min_app_version.
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: `co.aquafix.capture${suffix}`,
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: "Take photos for inspections, incidents and notes.",
      NSPhotoLibraryUsageDescription: "Attach photos to inspections, incidents and notes.",
      ...(isDev ? { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } } : {}),
    },
  },
  android: {
    package: `co.aquafix.capture${suffix.replace(/-/g, "_")}`,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["CAMERA"],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    "expo-status-bar",
    "expo-secure-store",
    [
      "expo-build-properties",
      {
        android: { minSdkVersion: 29, usesCleartextTraffic: isDev },
        ios: { deploymentTarget: "16.4" },
      },
    ],
    [
      "expo-image-picker",
      {
        cameraPermission: "Take photos for inspections, incidents and notes.",
        photosPermission: "Attach photos to inspections, incidents and notes.",
      },
    ],
    "@react-native-community/datetimepicker",
    "@sentry/react-native",
    "expo-image",
    // Windows: keep native object paths under ninja's 260-character limit.
    "./plugins/with-cmake-object-path-max",
  ],
  extra: {
    appEnv: APP_ENV,
  },
});
