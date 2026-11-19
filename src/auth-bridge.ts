import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, getRedirectResult, signInWithRedirect } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';
import { LOOPBACK_CONTINUE_URI } from './lib/loopbackAuth';

const statusEl = document.getElementById('status');
const detailEl = document.getElementById('detail');

const setMessage = (status: string, detail?: string) => {
  if (statusEl) statusEl.textContent = status;
  if (detailEl) detailEl.textContent = detail ?? '';
};

const sendToApp = (params: Record<string, string>) => {
  const url = `${LOOPBACK_CONTINUE_URI}?${new URLSearchParams(params).toString()}`;
  setMessage('アプリに戻っています…', 'この画面を閉じて、ABC Planner に戻ってください。');
  window.location.replace(url);
};

const run = async () => {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/userinfo.email');
  provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.idToken) {
        sendToApp({ error: 'missing_id_token' });
        return;
      }
      const params: Record<string, string> = { id_token: credential.idToken };
      if (credential.accessToken) {
        params.access_token = credential.accessToken;
      }
      sendToApp(params);
      return;
    }

    setMessage('Googleのログイン画面を開いています…');
    await signInWithRedirect(auth, provider);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'ログインに失敗しました。';
    setMessage('ログインできませんでした', message);
    sendToApp({ error: message });
  }
};

void run();
