# ABC Planner

重要度と緊急度の4つの領域でタスクを整理するプランナーです。

- アプリ名: **ABC Planner**
- Google Play 掲載名（予定）: **ABC ToDo Planner**
- パッケージ ID: `com.conta999.abcplanner`
- バージョン: 0.2.0

PC のブラウザと Android アプリで、同じ Google アカウントにログインすると Firestore で双方向同期します。未ログイン時は、その端末内にだけ保存します。

Web 版は Firebase の Web 用クライアント設定（`firebase-applet-config.json`）を使います。これはブラウザ公開を前提としたクライアントキーで、リポジトリに含めています。キーストアやパスワード、`google-services.json` は含めていません。

## ログインの仕組み

- **PC（ブラウザ）**: Firebase Auth の Google ポップアップで、その場で選んだアカウントにログインします。
- **Android**: `google-services.json` をアプリに入れてビルドする方式は使いません。ログイン時にシステムのブラウザ（Chrome Custom Tabs）で Google の公式ログイン画面を開き、選んだアカウントの ID トークンを `signInWithCredential` で Firebase Auth に渡します。戻り先は端末内の `http://127.0.0.1:41827/auth/callback` です。Google ドライブのバックアップ用トークンは、必要なときに同じ流れで取得します。

## 必要要件（一度だけ、Firebase / Google Cloud コンソール）

このリポジトリからは Firebase へのデプロイを行いません。同期と Android の Google ログインを有効にするには、プロジェクト `possible-retina-6mln4` で次を実施してください。

1. Firestore を **Native モード** で有効化する。
2. `firestore.rules` の内容を公開する（各ユーザーは `users/{uid}/**` だけ読み書きできるルール）。
3. Authentication で Google ログインを有効にする（Web ではすでに使っている場合あり）。
4. 承認済みドメインに、使う Web のドメインと `localhost`、必要なら `127.0.0.1` を追加する。
5. **Android のログイン用（重要）**: Google Cloud Console の「API とサービス」→「認証情報」で、Firebase の Google ログインが使っている **ウェブ アプリケーション** の OAuth クライアントを開き、承認済みのリダイレクト URI に次を追加する。
   - `http://127.0.0.1:41827/auth/callback`
   - クライアント ID の目安: `732782608365-qooa5q4opd01vd1qr0bdb60su5ck0m7a.apps.googleusercontent.com`（Firebase が自動作成したウェブ用クライアント）

Android アプリを Firebase に追加したり、SHA-1 を登録したり、`google-services.json` をビルドに入れたりする必要はありません。

## 開発

必要ツール: Node.js 22+、JDK 21、Android SDK（compileSdk / targetSdk 36）。

```bash
npm install
npm run dev          # ブラウザで開発
npm run build        # Web ビルド（server.ts も含む）
npx cap sync android # dist を Android プロジェクトへ同期
```

リリース用 APK は `android/app/build.gradle` の署名設定（git 管理外の `keystore.properties`）を使って組み立てます。キーストアはリポジトリに含めないでください。紛失すると Play の更新署名ができなくなります。
