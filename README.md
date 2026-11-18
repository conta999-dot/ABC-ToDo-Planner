# ABC Planner

重要度と緊急度の4つの領域でタスクを整理するプランナーです。

- アプリ名: **ABC Planner**
- Google Play 掲載名（予定）: **ABC ToDo Planner**
- パッケージ ID: `com.conta999.abcplanner`
- バージョン: 0.1.0

PC のブラウザと Android アプリで、同じ Google アカウントにログインすると Firestore で双方向同期します。未ログイン時は、その端末内にだけ保存します。

Web 版は Firebase の Web 用クライアント設定（`firebase-applet-config.json`）を使います。これはブラウザ公開を前提としたクライアントキーで、リポジトリに含めています。キーストアやパスワードは含めていません。

## 必要要件（Firebase コンソールでユーザーが行う作業）

このリポジトリからは Firebase へのデプロイを行いません。同期と Android の Google ログインを有効にするには、プロジェクト `possible-retina-6mln4`（または移行先の Firebase プロジェクト）で次を実施してください。

1. Firestore を **Native モード** で有効化する。
2. `firestore.rules` の内容を公開する（各ユーザーは `users/{uid}/**` だけ読み書きできるルール）。
3. Authentication で Google ログインを有効にする（Web ではすでに使っている場合あり）。
4. Android アプリを追加する。
   - パッケージ名: `com.conta999.abcplanner`
   - SHA-1 / SHA-256 はリリースキーの指紋を登録する（デバッグ用に使う場合はデバッグ鍵の指紋も追加）。
5. 必要なら `google-services.json` をダウンロードし、`android/app/google-services.json` に置く。  
   初回の APK は Web 用設定だけで Firestore を初期化するため、このファイルがなくてもビルドはできます。ただし **Android のネイティブ Google ログインは、コンソールで Android アプリと SHA-1 を登録するまで使えません。**
6. 承認済みドメインに、使う Web のドメインと `localhost` を追加する。

## 開発

必要ツール: Node.js 22+、JDK 21、Android SDK（compileSdk / targetSdk 36）。

```bash
npm install
npm run dev          # ブラウザで開発
npm run build        # Web ビルド（server.ts も含む）
npx cap sync android # dist を Android プロジェクトへ同期
```

リリース用 APK は `android/app/build.gradle` の署名設定（git 管理外の `keystore.properties`）を使って組み立てます。キーストアはリポジトリに含めないでください。紛失すると Play の更新署名ができなくなります。
