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
import { AUTH_BRIDGE_URL, LOOPBACK_AUTH_PATH, LOOPBACK_AUTH_PORT, LoopbackAuth } from './loopbackAuth';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const provider = new GoogleAuthProvider();
provider.addScope(DRIVE_SCOPE);
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
provider.setCustomParameters({ prompt: 'select_account' });

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

const signInWithSystemBrowser = async (): Promise<{ user: User; accessToken: string | null }> => {
  await LoopbackAuth.start({
    port: LOOPBACK_AUTH_PORT,
    path: LOOPBACK_AUTH_PATH,
  });
  try {
    await Browser.open({ url: AUTH_BRIDGE_URL });
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

    const idToken = callback.searchParams.get('id_token');
    const accessToken = callback.searchParams.get('access_token');
    if (!idToken) {
      throw new Error('Googleからの認証結果を受け取れませんでした。');
    }

    const credential = GoogleAuthProvider.credential(idToken, accessToken || undefined);
    const userCred = await signInWithCredential(auth, credential);
    cachedAccessToken = accessToken;
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
