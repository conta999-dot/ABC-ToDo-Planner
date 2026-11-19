# ABC ToDo Planner

重要度と緊急度の4つの領域でタスクを整理するプランナーです。

- アプリ名: **ABC ToDo Planner**
- Google Play 掲載名（予定）: **ABC ToDo Planner**
- パッケージ ID: `com.conta999.abctodoplanner`
- バージョン: 0.5.0（versionCode 6）
- Firebase プロジェクト: `abc-todo-planner-1b179`
- PC 版: https://conta999-dot.github.io/ABC-ToDo-Planner/

PC のブラウザと Android アプリで、同じ Google アカウントにログインすると Firestore で双方向同期します。未ログイン時は、その端末内にだけ保存します。

Web 版は Firebase の Web 用クライアント設定（`firebase-applet-config.json`）を使います。これはブラウザ公開を前提としたクライアントキーで、リポジトリに含めています。キーストアやパスワード、`google-services.json` は含めていません。

## ログインの仕組み

- **PC（ブラウザ）**: Firebase Auth の Google ポップアップで、その場で選んだアカウントにログインします。
- **Android**: `google-services.json` は使いません。システムのブラウザで、GitHub Pages 上のログイン用ページ（`auth.html`）を開きます。そこから Firebase 標準の `signInWithRedirect`（リダイレクト先は `https://abc-todo-planner-1b179.firebaseapp.com/__/auth/handler`）で Google の公式画面を表示し、選んだアカウントの ID トークンを端末内の `http://127.0.0.1:41827/auth/callback` 経由でアプリに戻し、`signInWithCredential` します。Google Cloud で Android アプリや SHA-1、OAuth のリダイレクト URI を追加する必要はありません。

## Google カレンダーへのエクスポート（v0.5.0〜）

設定画面（右上の歯車）の「エクスポート」で、**完了したタスクだけ**を Google カレンダー（メインのカレンダー）に終日予定として登録します。

- 予定名: `プレフィックス＋重要度＋緊急度＋タスク名＋（完了予定日）` 例: `[ABC]A1 企画書を提出（2026/11/19）`（プレフィックスは端末ごとに保存）
- 予定の日付: 完了日（未入力なら実施予定日）
- 予定の詳細: タスクの「メモ・詳細」
- 重複防止: 予定の `extendedProperties.private`（`abcTodoPlanner=1`, `abcTaskId=<タスクID>`）で登録済みかを判定し、内容が変わっていれば更新、同じならスキップします。
- 権限: `https://www.googleapis.com/auth/calendar.events`（Android はネイティブの AuthorizationClient、Web は Firebase のポップアップ再認証で取得）
- 事前に Google Cloud で「Google Calendar API」を有効にしておく必要があります。

アイコンの元データは `design/icon/`（`gen_svg.py` で SVG を作り、`render.mjs` で各サイズの PNG を書き出し）。

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
