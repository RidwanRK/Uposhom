import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Android only. Permissions follow Master Plan section 4.1:
 * CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED,
 * ACCESS_COARSE_LOCATION, VIBRATE, INTERNET.
 *
 * No Applink variable ever appears here: the app only talks to our own API (EXPO_PUBLIC_API_URL).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'উপশম',
  slug: 'uposhom',
  scheme: 'uposhom',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light', // single light, high-contrast theme (design.md section 8)
  icon: './assets/icon.png',
  backgroundColor: '#F6FAF8',
  platforms: ['android'],
  android: {
    package: 'bd.uposhom.app',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundColor: '#0D5C52',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.VIBRATE',
      'android.permission.INTERNET',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ],
    blockedPermissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    // Expo Push (caregiver alerts) needs FCM credentials. Optional: SMS stays the fallback channel.
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON,
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', backgroundColor: '#0D5C52', imageWidth: 200 },
    ],
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/NotoSansBengali-Regular.ttf',
          './assets/fonts/NotoSansBengali-Medium.ttf',
          './assets/fonts/NotoSansBengali-SemiBold.ttf',
          './assets/fonts/NotoSansBengali-Bold.ttf',
        ],
      },
    ],
    'expo-secure-store',
    'expo-sqlite',
    [
      'expo-camera',
      {
        cameraPermission: 'প্রেসক্রিপশনের ছবি তুলতে উপশমের ক্যামেরা দরকার।',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'গ্যালারি থেকে প্রেসক্রিপশনের ছবি বেছে নিতে অনুমতি দরকার।',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      'expo-location',
      { locationWhenInUsePermission: 'কাছের ফার্মেসি দেখাতে আনুমানিক অবস্থান দরকার।' },
    ],
    ['expo-audio', { microphonePermission: 'বাংলায় কথা বলে জানাতে মাইক্রোফোন দরকার।' }],
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
    'expo-notifications',
    'expo-dev-client',
  ],
  extra: {
    // Our own backend only. Mock mode serves seeded synthetic data until the live endpoints land.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
    useMock: process.env.EXPO_PUBLIC_USE_MOCK ?? '',
  },
});
