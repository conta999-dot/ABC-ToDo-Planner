# ABC Planner

重要度と緊急度の4つの領域でタスクを整理するプランナーです。

- アプリ名: **ABC Planner**
- Google Play 掲載名（予定）: **ABC ToDo Planner**
- パッケージ ID: `com.conta999.abctodoplanner`
- バージョン: 0.3.0
- Firebase プロジェクト: `abc-todo-planner-1b179`
- PC 版: https://conta999-dot.github.io/ABC-ToDo-Planner/

PC のブラウザと Android アプリで、同じ Google アカウントにログインすると Firestore で双方向同期します。未ログイン時は、その端末内にだけ保存します。

Web 版は Firebase の Web 用クライアント設定（`firebase-applet-config.json`）を使います。これはブラウザ公開を前提としたクライアントキーで、リポジトリに含めています。キーストアやパスワード、`google-services.json` は含めていません。

## ログインの仕組み

- **PC（ブラウザ）**: Firebase Auth の Google ポップアップで、その場で選んだアカウントにログインします。
- **Android**: `google-services.json` は使いません。システムのブラウザで、GitHub Pages 上のログイン用ページ（`auth.html`）を開きます。そこから Firebase 標準の `signInWithRedirect`（リダイレクト先は `https://abc-todo-planner-1b179.firebaseapp.com/__/auth/handler`）で Google の公式画面を表示し、選んだアカウントの ID トークンを端末内の `http://127.0.0.1:41827/auth/callback` 経由でアプリに戻し、`signInWithCredential` します。Google Cloud で Android アプリや SHA-1、OAuth のリダイレクト URI を追加する必要はありません。

## 必要要件（一度だけ、Firebase コンソール）

Firebase CLI からのデプロイは行いません。次をコンソールで実施してください。

1. [Firestore のルール](https://console.firebase.google.com/project/abc-todo-planner-1b179/firestore/rules) に、リポジトリの `firestore.rules` を貼って公開する（各ユーザーは `users/{uid}/**` だけ読み書きできるルール）。
2. [Authentication の設定](https://console.firebase.google.com/project/abc-todo-planner-1b179/authentication/settings) の「承認済みドメイン」に `conta999-dot.github.io` を追加する（`localhost` は通常すでにあります）。

## 開発

必要ツール: Node.js 22+、JDK 21、Android SDK（compileSdk / targetSdk 36）。

```bash
npm install
npm run dev          # ブラウザで開発
npm run build        # Web ビルド（server.ts も含む）
npx cap sync android # dist を Android プロジェクトへ同期
```

リリース用 APK は `android/app/build.gradle` の署名設定（git 管理外の `keystore.properties`）を使って組み立てます。キーストアはリポジトリに含めないでください。紛失すると Play の更新署名ができなくなります。
