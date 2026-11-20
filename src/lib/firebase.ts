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
import { NativeGoogleAuth, nativeAuthErrorMessage, errorDetail } from './nativeGoogleAuth';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

export const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
provider.setCustomParameters({ prompt: 'select_account' });

export const isFirebaseAvailable = true;

let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, null);
    } else {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export type FriendlyError = Error & { code?: string; detail?: string; stage?: string };

const toFriendlyError = (
  error: unknown,
  kind: 'signIn' | 'authorize',
  stage: string,
  friendlyOverride?: string,
): FriendlyError => {
  const e = new Error(friendlyOverride ?? nativeAuthErrorMessage(error, kind)) as FriendlyError;
  e.code = (error as { code?: string } | null)?.code;
  e.stage = stage;
  e.detail = `[${stage}] ${errorDetail(error)}`;
  return e;
};

/** Android: Credential Manager によるネイティブ Google ログイン */
const signInWithNativeGoogle = async (): Promise<{ user: User }> => {
  if (!GOOGLE_WEB_CLIENT_ID || (GOOGLE_WEB_CLIENT_ID as string) === 'REPLACE_ME') {
    throw toFriendlyError({ code: 'MISCONFIGURED', message: 'GOOGLE_WEB_CLIENT_ID is not set' }, 'signIn', 'アプリ設定');
  }
  let idToken: string;
  try {
    ({ idToken } = await NativeGoogleAuth.signIn({ serverClientId: GOOGLE_WEB_CLIENT_ID }));
  } catch (error) {
    throw toFriendlyError(error, 'signIn', 'Googleアカウント選択（Credential Manager）');
  }
  let userCred;
  try {
    userCred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? '';
    let friendly = 'Googleアカウントは選べましたが、Firebaseへのログインに失敗しました。';
    if (code === 'auth/network-request-failed') friendly = 'ネットワークに接続できず、Firebaseへのログインに失敗しました。通信状態を確認してください。';
    else if (code === 'auth/invalid-credential' || code === 'auth/operation-not-allowed' || code === 'auth/invalid-api-key') {
      friendly = 'Googleアカウントは選べましたが、FirebaseがログインのIDトークンを受け付けませんでした（Firebase側のGoogleログイン設定を確認）。';
    }
    throw toFriendlyError(error, 'signIn', 'Firebaseログイン（signInWithCredential）', friendly);
  }
  return { user: userCred.user };
};

export const googleSignIn = async (): Promise<{ user: User } | null> => {
  try {
    isSigningIn = true;

    if (Capacitor.isNativePlatform()) {
      return await signInWithNativeGoogle();
    }

    let result;
    try {
      result = await signInWithPopup(auth, provider);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? '';
      const friendly =
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? 'ログインがキャンセルされました。'
          : code === 'auth/popup-blocked'
            ? 'ログイン用のポップアップがブロックされました。ブラウザのポップアップ許可を確認してください。'
            : code === 'auth/unauthorized-domain'
              ? 'このページのドメインがFirebaseの「承認済みドメイン」に登録されていません。'
              : code === 'auth/network-request-failed'
                ? 'ネットワークに接続できず、ログインに失敗しました。'
                : 'Googleログインに失敗しました。';
      throw toFriendlyError(error, 'signIn', 'Webログイン（ポップアップ）', friendly);
    }
    return { user: result.user };
  } catch (error: unknown) {
    console.error('サインイン中にエラーが発生しました:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
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
};

export const isSigningInProgress = () => isSigningIn;
