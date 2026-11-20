import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  reauthenticateWithPopup,
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

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const provider = new GoogleAuthProvider();
provider.addScope(DRIVE_SCOPE);
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
provider.setCustomParameters({ prompt: 'select_account' });

export const isFirebaseAvailable = true;

let cachedAccessToken: string | null = null;
let cachedAccessTokenAt = 0;
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
    throw toFriendlyError(error, 'authorize', 'Drive許可');
  }
};

/** Android: Credential Manager によるネイティブ Google ログイン */
const signInWithNativeGoogle = async (): Promise<{ user: User; accessToken: string | null }> => {
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
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;
    cachedAccessTokenAt = Date.now();
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
  // Web: ポップアップで得たトークンはページを開き直すと消え、約1時間で期限切れになる
  if (cachedAccessToken && Date.now() - cachedAccessTokenAt > 50 * 60 * 1000) cachedAccessToken = null;
  if (!cachedAccessToken && options?.interactive && auth.currentUser) {
    // 同じGoogleアカウントでもう一度許可してもらい、Drive 用のトークンを取り直す
    const result = await reauthenticateWithPopup(auth.currentUser, provider);
    cachedAccessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? null;
    cachedAccessTokenAt = Date.now();
  }
  return cachedAccessToken;
};

/** Drive がトークン無効（401）を返したとき、次回は取り直す */
export const clearDriveToken = () => {
  cachedAccessToken = null;
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
