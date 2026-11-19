import { registerPlugin } from '@capacitor/core';

export const LOOPBACK_AUTH_PORT = 41827;
export const LOOPBACK_AUTH_PATH = '/auth/callback';
export const LOOPBACK_CONTINUE_URI = `http://127.0.0.1:${LOOPBACK_AUTH_PORT}${LOOPBACK_AUTH_PATH}`;

export interface LoopbackAuthPlugin {
  start(options: { port: number; path: string }): Promise<{ port: number; continueUri: string }>;
  waitForCallback(options?: { timeoutMs?: number }): Promise<{ requestUri: string }>;
  stop(): Promise<void>;
}

export const LoopbackAuth = registerPlugin<LoopbackAuthPlugin>('LoopbackAuth');
