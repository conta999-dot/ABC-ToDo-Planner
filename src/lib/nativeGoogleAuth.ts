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
      return 'Googleログインの設定がまだ完了していません（アプリの登録情報またはSHA-1の未登録）。開発者に連絡してください。';
    case 'NEED_INTERACTION':
      return 'Googleドライブへのアクセス許可が必要です。';
    default: {
      const msg = error instanceof Error ? error.message : String(error ?? '');
      return `Googleログインに失敗しました。${msg ? `（${msg}）` : ''}`;
    }
  }
};
