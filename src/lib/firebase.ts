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

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
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

const signInWithNativeGoogle = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  try {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Google IDトークンを取得できませんでした。');
    }
    const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
    const userCred = await signInWithCredential(auth, credential);
    cachedAccessToken = result.credential?.accessToken ?? null;
    return { user: userCred.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.warn('ネイティブGoogleログインに失敗したため、Web方式を試します:', error);
    return null;
  }
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string | null } | null> => {
  try {
    isSigningIn = true;

    if (Capacitor.isNativePlatform()) {
      const nativeResult = await signInWithNativeGoogle();
      if (nativeResult) {
        return nativeResult;
      }
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

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      await FirebaseAuthentication.signOut();
    } catch (error) {
      console.warn('ネイティブログアウトをスキップしました:', error);
    }
  }
  await signOut(auth);
  cachedAccessToken = null;
};

export const isSigningInProgress = () => isSigningIn;
