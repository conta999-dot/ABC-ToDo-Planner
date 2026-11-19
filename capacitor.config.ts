import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.conta999.abctodoplanner',
  appName: 'ABC ToDo Planner',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#18181b',
    },
  },
};

export default config;
