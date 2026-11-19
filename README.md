# ABC ToDo Planner

重要度と緊急度の4つの領域でタスクを整理するプランナーです。

- アプリ名: **ABC ToDo Planner**
- Google Play 掲載名（予定）: **ABC ToDo Planner**
- パッケージ ID: `com.conta999.abctodoplanner`
- バージョン: 0.5.2（versionCode 8）
- Firebase プロジェクト: `abc-todo-planner-1b179`
- PC 版: https://conta999-dot.github.io/ABC-ToDo-Planner/

PC のブラウザと Android アプリで、同じ Google アカウントにログインすると Firestore で双方向同期します。未ログイン時は、その端末内にだけ保存します。

Web 版は Firebase の Web 用クライアント設定（`firebase-applet-config.json`）を使います。これはブラウザ公開を前提としたクライアントキーで、リポジトリに含めています。キーストアやパスワード、`google-services.json` は含めていません。

## ログインの仕組み

- **PC（ブラウザ）**: Firebase Auth の Google ポップアップで、その場で選んだアカウントにログインします。
- **Android**: `google-services.json` は使いません。システムのブラウザで、GitHub Pages 上のログイン用ページ（`auth.html`）を開きます。そこから Firebase 標準の `signInWithRedirect`（リダイレクト先は `https://abc-todo-planner-1b179.firebaseapp.com/__/auth/handler`）で Google の公式画面を表示し、選んだアカウントの ID トークンを端末内の `http://127.0.0.1:41827/auth/callback` 経由でアプリに戻し、`signInWithCredential` します。Google Cloud で Android アプリや SHA-1、OAuth のリダイレクト URI を追加する必要はありません。

## カレンダーへのエクスポート（Android のみ・v0.5.1〜、v0.5.2 で記録方式を変更）

設定画面（右上の歯車）の「エクスポート」で、**完了したタスクだけ**を、端末内のカレンダー（Android の CalendarContract）に終日予定として書き込みます。Google アカウントのカレンダーを選べば、クラウドへの同期は端末の Google カレンダー側が行います。Google Calendar API や Google Cloud の設定は不要で、通信もしません（Web 版にはエクスポートはありません）。

- 権限: `READ_CALENDAR` / `WRITE_CALENDAR`（初回に許可ダイアログ）
- 登録先: 書き込み可能なカレンダーから選択（既定はログイン中のメールと同じ Google アカウントのカレンダー、なければ主カレンダー）。選択は端末に保存
- 予定名: `プレフィックス＋重要度＋緊急度＋タスク名＋（完了予定日）` 例: `[ABC]A1 企画書を提出（2026/11/19）`
- 予定の日付: 完了日（未入力なら実施予定日）。終日予定（UTC 0:00〜翌日 0:00、タイムゾーン UTC）
- 予定の詳細: タスクの「メモ・詳細」だけ（カレンダーに目印などは書き込まない）
- 重複防止（v0.5.2〜）: エクスポートした記録をタスク側に保存する（Firestore で同期）。
  - `calendarExported: true`（エクスポート済みフラグ）
  - `calendarExports["<端末ID>_<カレンダーID>"] = { deviceId, calendarId, eventId, exportedAt, hash }`
  - 記録なし → 新規登録。記録あり → 予定ID（CalendarContract の `_id`）で予定を探し、内容（タイトル・日付・説明）のハッシュが違えば更新、同じならスキップ。予定が削除されていたら新規登録して記録を更新。
  - 予定IDは端末ごとに違うため、別の端末・別のカレンダーの記録しかないタスクは、その端末・カレンダーでは未登録として新規登録する。
  - 端末IDはアプリのインストールごとに作るID（アプリを入れ直すと変わり、以前の予定は「別の端末」扱いになる）。
  - v0.5.1 で説明欄に入れていた `abc-task:<ID>` の目印は、エクスポート時に選択カレンダー内の予定から自動で取り除き、その予定を記録に引き継ぐ（重複しない）。
- 実装: `android/app/src/main/java/com/conta999/abctodoplanner/DeviceCalendarPlugin.java`、`src/lib/calendar.ts`

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
