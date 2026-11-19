import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import firebaseConfig from '../../firebase-applet-config.json';
import { LOOPBACK_AUTH_PATH, LOOPBACK_AUTH_PORT, LOOPBACK_CONTINUE_URI, LoopbackAuth } from './loopbackAuth';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  DRIVE_SCOPE,
].join(' ');

export const provider = new GoogleAuthProvider();
provider.addScope(DRIVE_SCOPE);
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');

export const isFirebaseAvailable = true;

let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

const createAuthUri = async (continueUri: string): Promise<{ authUri: string; sessionId: string }> => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        continueUri,
        providerId: 'google.com',
        authType: 'signInWithRedirect',
        oauthScope: OAUTH_SCOPES,
      }),
    }
  );
  const data = await response.json() as { authUri?: string; sessionId?: string; error?: { message?: string } };
  if (!response.ok || !data.authUri || !data.sessionId) {
    throw new Error(data.error?.message || 'Googleログイン用のURLを作成できませんでした。');
  }
  return { authUri: data.authUri, sessionId: data.sessionId };
};

const signInWithIdp = async (requestUri: string, sessionId: string) => {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestUri,
        sessionId,
        returnSecureToken: true,
        returnIdpCredential: true,
      }),
    }
  );
  const data = await response.json() as {
    error?: { message?: string };
    oauthIdToken?: string;
    oauthAccessToken?: string;
    idToken?: string;
  };
  if (!response.ok) {
    throw new Error(data.error?.message || 'Googleアカウントでの認証に失敗しました。');
  }
  return data;
};

const signInWithSystemBrowser = async (): Promise<{ user: User; accessToken: string | null }> => {
  const started = await LoopbackAuth.start({
    port: LOOPBACK_AUTH_PORT,
    path: LOOPBACK_AUTH_PATH,
  });
  const continueUri = started.continueUri || LOOPBACK_CONTINUE_URI;
  try {
    const { authUri, sessionId } = await createAuthUri(continueUri);
    await Browser.open({ url: authUri });
    const { requestUri } = await LoopbackAuth.waitForCallback({ timeoutMs: 180000 });
    try {
      await Browser.close();
    } catch {
      // Custom Tabs may already have been dismissed.
    }

    const callback = new URL(requestUri);
    const oauthError = callback.searchParams.get('error');
    if (oauthError) {
      if (oauthError === 'access_denied') {
        throw new Error('ログインがキャンセルされました。');
      }
      throw new Error(`Googleログインに失敗しました（${oauthError}）。`);
    }
    if (!callback.searchParams.get('code') && !callback.searchParams.get('id_token')) {
      throw new Error('Googleからの認証結果を受け取れませんでした。');
    }

    const idp = await signInWithIdp(requestUri, sessionId);
    if (!idp.oauthIdToken) {
      throw new Error('Google IDトークンを取得できませんでした。');
    }
    const credential = GoogleAuthProvider.credential(idp.oauthIdToken, idp.oauthAccessToken);
    const userCred = await signInWithCredential(auth, credential);
    cachedAccessToken = idp.oauthAccessToken ?? null;
    return { user: userCred.user, accessToken: cachedAccessToken };
  } finally {
    try {
      await LoopbackAuth.stop();
    } catch {
      // ignore
    }
  }
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  try {
    isSigningIn = true;

    if (Capacitor.isNativePlatform()) {
      return await signInWithSystemBrowser();
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: unknown) {
    console.error('サインイン中にエラーが発生しました:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (options?: { interactive?: boolean }): Promise<string | null> => {
  if (cachedAccessToken) {
    return cachedAccessToken;
  }
  if (options?.interactive && Capacitor.isNativePlatform() && auth.currentUser) {
    const result = await signInWithSystemBrowser();
    return result.accessToken;
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

export const isSigningInProgress = () => isSigningIn;
