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
import firebaseConfig from '../../firebase-applet-config.json';
import { GOOGLE_WEB_CLIENT_ID } from './authConfig';
import { NativeGoogleAuth, nativeAuthErrorMessage } from './nativeGoogleAuth';

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

const toFriendlyError = (error: unknown, kind: 'signIn' | 'authorize') => {
  const e = new Error(nativeAuthErrorMessage(error, kind)) as Error & { code?: string };
  e.code = (error as { code?: string } | null)?.code;
  return e;
};

/** Android: ネイティブ Drive 権限（drive.file）でアクセストークンを取得 */
const nativeAuthorizeDrive = async (interactive: boolean): Promise<string | null> => {
  try {
    const { accessToken } = await NativeGoogleAuth.authorize({ scopes: [DRIVE_SCOPE], interactive });
    cachedAccessToken = accessToken;
    return accessToken;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (!interactive && code === 'NEED_INTERACTION') return null;
    if (!interactive) {
      console.warn('Driveトークンのサイレント取得に失敗:', error);
      return null;
    }
    throw toFriendlyError(error, 'authorize');
  }
};

/** Android: Credential Manager によるネイティブ Google ログイン */
const signInWithNativeGoogle = async (): Promise<{ user: User; accessToken: string | null }> => {
  if (!GOOGLE_WEB_CLIENT_ID || GOOGLE_WEB_CLIENT_ID === 'REPLACE_ME') {
    throw toFriendlyError({ code: 'MISCONFIGURED' }, 'signIn');
  }
  let idToken: string;
  try {
    ({ idToken } = await NativeGoogleAuth.signIn({ serverClientId: GOOGLE_WEB_CLIENT_ID }));
  } catch (error) {
    throw toFriendlyError(error, 'signIn');
  }
  let userCred;
  try {
    userCred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? '';
    if (code === 'auth/invalid-credential' || code === 'auth/operation-not-allowed' || code === 'auth/invalid-api-key') {
      throw toFriendlyError({ code: 'MISCONFIGURED' }, 'signIn');
    }
    throw toFriendlyError(error, 'signIn');
  }
  // Drive 権限は付与済みなら静かに取得（未許可なら手動同期時に許可画面を出す）
  const accessToken = await nativeAuthorizeDrive(false);
  return { user: userCred.user, accessToken };
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  try {
    isSigningIn = true;

    if (Capacitor.isNativePlatform()) {
      return await signInWithNativeGoogle();
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
  if (Capacitor.isNativePlatform()) {
    // AuthorizationClient はキャッシュ済みの有効なトークンを返すため毎回問い合わせる
    if (!auth.currentUser) return null;
    return await nativeAuthorizeDrive(!!options?.interactive);
  }
  return cachedAccessToken;
};

export const logout = async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      await NativeGoogleAuth.signOut();
    } catch {
      // ignore
    }
  }
  await signOut(auth);
  cachedAccessToken = null;
};

export const isSigningInProgress = () => isSigningIn;
