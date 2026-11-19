import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  UserCredential,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';
import { LOOPBACK_CONTINUE_URI } from './lib/loopbackAuth';

const statusEl = document.getElementById('status');
const detailEl = document.getElementById('detail');
const loginBtn = document.getElementById('login') as HTMLButtonElement | null;
const REDIRECT_FLAG = 'abc_auth_redirect_tried';

const setMessage = (status: string, detail?: string) => {
  if (statusEl) statusEl.textContent = status;
  if (detailEl) detailEl.textContent = detail ?? '';
};

const sendToApp = (params: Record<string, string>) => {
  sessionStorage.removeItem(REDIRECT_FLAG);
  const url = `${LOOPBACK_CONTINUE_URI}?${new URLSearchParams(params).toString()}`;
  setMessage('アプリに戻っています…', 'この画面を閉じて、ABC Planner に戻ってください。');
  if (loginBtn) loginBtn.style.display = 'none';
  window.location.replace(url);
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
provider.setCustomParameters({ prompt: 'select_account' });

const handleResult = (result: UserCredential) => {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.idToken) {
    sendToApp({ error: 'missing_id_token' });
    return;
  }
  const params: Record<string, string> = { id_token: credential.idToken };
  if (credential.accessToken) params.access_token = credential.accessToken;
  sendToApp(params);
};

const showButton = (status: string, detail: string) => {
  setMessage(status, detail);
  if (loginBtn) {
    loginBtn.style.display = 'inline-block';
    loginBtn.disabled = false;
  }
};

const startPopup = async () => {
  if (loginBtn) loginBtn.disabled = true;
  setMessage('Googleのログイン画面を開いています…', 'アカウントを選んでください。');
  try {
    // ポップアップ方式はブラウザのサードパーティ Cookie 制限の影響を受けないため、ループしない。
    const result = await signInWithPopup(auth, provider);
    handleResult(result);
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      // ポップアップが使えない環境だけ、1回だけリダイレクト方式を試す。
      sessionStorage.setItem(REDIRECT_FLAG, '1');
      await signInWithRedirect(auth, provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      showButton('ログインがキャンセルされました', 'もう一度ボタンを押してください。');
      return;
    }
    const message = error instanceof Error ? error.message : 'ログインに失敗しました。';
    showButton('ログインできませんでした', message);
  }
};

const run = async () => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      handleResult(result);
      return;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'ログインに失敗しました。';
    sessionStorage.removeItem(REDIRECT_FLAG);
    showButton('ログインできませんでした', message);
    return;
  }
  if (sessionStorage.getItem(REDIRECT_FLAG)) {
    sessionStorage.removeItem(REDIRECT_FLAG);
    showButton('ログインを完了できませんでした', 'もう一度ボタンを押してください。');
    return;
  }
  showButton('ABC Planner にログイン', '下のボタンを押して、Googleアカウントを選んでください。');
};

loginBtn?.addEventListener('click', () => {
  void startPopup();
});

void run();
