import { registerPlugin } from '@capacitor/core';

export interface NativeGoogleAuthPlugin {
  /** Credential Manager で Google アカウントを選び、ID トークンを返す */
  signIn(options: { serverClientId: string }): Promise<{ idToken: string; email?: string; displayName?: string }>;
  /** Credential Manager の状態をクリア（次回アカウント選択を出す） */
  signOut(): Promise<void>;
  /** AuthorizationClient で指定スコープのアクセストークンを取得 */
  authorize(options: { scopes: string[]; interactive?: boolean }): Promise<{ accessToken: string }>;
}

export const NativeGoogleAuth = registerPlugin<NativeGoogleAuthPlugin>('NativeGoogleAuth');

/** ネイティブ側のエラーコードを日本語メッセージに変換する */
export const nativeAuthErrorMessage = (error: unknown, kind: 'signIn' | 'authorize' = 'signIn'): string => {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case 'CANCELLED':
      return kind === 'signIn'
        ? 'ログインがキャンセルされました。'
        : 'Googleドライブへのアクセス許可がキャンセルされました。';
    case 'NO_ACCOUNT':
      return 'この端末にGoogleアカウントが見つかりません。Androidの「設定 > パスワードとアカウント」でGoogleアカウントを追加してから、もう一度お試しください。';
    case 'MISCONFIGURED':
      return 'Googleログインの設定が合っていません。FirebaseのAndroidアプリ（com.conta999.abctodoplanner）にSHA-1が登録されているか確認してください。';
    case 'NEED_INTERACTION':
      return 'Googleドライブへのアクセス許可が必要です。';
    default: {
      const msg = error instanceof Error ? error.message : String(error ?? '');
      return `Googleログインに失敗しました。${msg ? `（${msg}）` : ''}`;
    }
  }
};

/** スクショで原因を特定できるよう、生のエラー情報（コード・クラス・メッセージ）を1つの文字列にする */
export const errorDetail = (error: unknown): string => {
  if (error == null) return '';
  const e = error as {
    code?: string;
    message?: string;
    name?: string;
    data?: { className?: string; type?: string; message?: string; statusCode?: number; cause?: string };
    customData?: Record<string, unknown>;
  };
  const parts: string[] = [];
  if (e.code) parts.push(`code=${e.code}`);
  const d = e.data;
  if (d?.className) parts.push(d.className.split('.').pop() as string);
  if (d?.type) parts.push(`type=${d.type}`);
  if (typeof d?.statusCode === 'number') parts.push(`status=${d.statusCode}`);
  const msg = d?.message || e.message || (typeof error === 'string' ? error : '');
  if (msg) parts.push(msg);
  if (d?.cause) parts.push(`cause=${d.cause}`);
  if (parts.length === 0) {
    try {
      parts.push(JSON.stringify(error));
    } catch {
      parts.push(String(error));
    }
  }
  return parts.join(' / ');
};
