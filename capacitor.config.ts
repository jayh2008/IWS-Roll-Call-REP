import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rollcall.app',
  appName: 'Roll Call',
  webDir: 'www',
  bundledWebRuntime: false,
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      backgroundColor: "#3F51B5",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP"
    },
    Permissions: {
      camera: "prompt",
      storage: "prompt"
    },
    BarcodeScanner: {
      cameraPermissionText: "This app needs camera access to scan QR codes"
    }
  },
  server: {
    androidScheme: 'https'
  }
};

export default config;
