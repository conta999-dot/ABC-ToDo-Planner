import { registerPlugin } from '@capacitor/core';

export const LOOPBACK_AUTH_PORT = 41827;
export const LOOPBACK_AUTH_PATH = '/auth/callback';
export const LOOPBACK_CONTINUE_URI = `http://127.0.0.1:${LOOPBACK_AUTH_PORT}${LOOPBACK_AUTH_PATH}`;

/** PC 版と Android ログイン用ブリッジを置く公開URL（GitHub Pages） */
export const WEB_APP_URL = 'https://conta999-dot.github.io/ABC-ToDo-Planner';
export const AUTH_BRIDGE_URL = `${WEB_APP_URL}/auth.html`;

export interface LoopbackAuthPlugin {
  start(options: { port: number; path: string }): Promise<{ port: number; continueUri: string }>;
  waitForCallback(options?: { timeoutMs?: number }): Promise<{ requestUri: string }>;
  stop(): Promise<void>;
}

export const LoopbackAuth = registerPlugin<LoopbackAuthPlugin>('LoopbackAuth');
