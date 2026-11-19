import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const gitCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();
const buildTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_COMMIT__: JSON.stringify(process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : gitCommit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        auth: 'auth.html',
      },
    },
  },
  server: {
    port: 3000,
    host: true,
  },
});
