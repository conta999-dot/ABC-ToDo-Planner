import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.conta999.abcplanner',
  appName: 'ABC Planner',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#18181b',
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
    },
  },
};

export default config;
