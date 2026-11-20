# ABC ToDo Planner

重要度と緊急度の4つの領域でタスクを整理するプランナーです。

- アプリ名: **ABC ToDo Planner**
- Google Play 掲載名（予定）: **ABC ToDo Planner**
- パッケージ ID: `com.conta999.abctodoplanner`
- バージョン: 0.6.2（versionCode 12）
- Firebase プロジェクト: `abc-todo-planner-1b179`
- PC 版: https://conta999-dot.github.io/ABC-ToDo-Planner/

PC のブラウザと Android アプリで、同じ Google アカウントにログインすると Firestore で双方向同期します。未ログイン時は、その端末内にだけ保存します。

Web 版は Firebase の Web 用クライアント設定（`firebase-applet-config.json`）を使います。これはブラウザ公開を前提としたクライアントキーで、リポジトリに含めています。キーストアやパスワード、`google-services.json` は含めていません。

## 画面と操作（v0.6.1〜）

- 初期表示: Web・Android とも「デイリー」
- Web（PC）は画面の縦横いっぱいに表示（Full HD 基準）。ヘッダー・タブ・簡易登録は常に表示し、タスク部分だけがスクロール
- タスクはすべてのタブで1行表示（タスク内容が長いときだけ折り返し）
- 行の左の「達成状況」の四角（✓ 完了 / ・ 進行中 / → 先送り / ○ 委任 / × 削除 / 空 未達成）をタップするとプルダウン
- 色付きの「B1」などのバッジをタップすると、重要度と緊急度をまとめて選ぶプルダウン（A1… / B1… / C1… の順）
- タスク名タップで詳細画面、日付タップでカレンダー（日付選択）
- ポップアップ（使い方・領域の説明・エラー表示）は、背景を暗くぼかし、明るめのカードとはっきりした枠で表示（v0.6.2〜）
- PC のデイリーは 4 列×2 段（幅 2200px 以上は 7 列）で、1 行表示が読める幅を確保
- すべてのタブに「達成状況」の絞り込み（タブ間で共通）と「期日」の並べ替えボタン（押すたびに昇順⇄降順）
- 並び順: 起動時は期日の降順。同じ日の中は常に 重要度 A→B→C→なし、緊急度 1→2→3…（追加・編集したタスクもすぐ正しい位置に並ぶ）
- デイリー: タスクを別の日へドラッグ＆ドロップで実施予定日を変更。「？ 週プランナーの使い方」でポップアップ説明
- 4つの領域: タスクを別の領域へドラッグ＆ドロップで重要度・緊急度を変更（下表）
- スマホ（タッチ）は 0.25 秒ほど長押ししてからドラッグ（長押し前に指を動かすと通常のスクロール）。画面の端に近づけると自動でスクロール

| ドロップ先 | 変更内容 |
|---|---|
| 第Ⅰ領域 | 重要度を A に。緊急度は A の中で次の番号（最大番号＋1） |
| 第Ⅱ領域 | 重要度を B に。緊急度は B の中で次の番号 |
| 第Ⅲ領域 | 重要度 A・B は C に（C・なしはそのまま）。緊急度はその重要度の中で次の番号 |
| 第Ⅳ領域 | 重要度 A・B は C に（C・なしはそのまま）。緊急度をなしに |

実装: `src/components/TaskRow.tsx`（行・プルダウン・日付・並べ替え）、`src/lib/useTaskDrag.ts`（マウス・タッチのドラッグ）、`src/lib/quadrantMove.ts`（領域ごとの変更ルール）

## ファイルへの保存・読込（v0.6.2〜）

- Web: 「JSON書出」「CSV書出」でブラウザのダウンロード
- Android: アプリ内のブラウザ（WebView）はダウンロードに対応していないため、端末の「ドキュメント/ABCToDoPlanner」に保存し、続けて共有メニュー（Googleドライブ・ファイル・メール等）を開く（`@capacitor/filesystem`、`@capacitor/share`）
- CSV は完了日・更新日時・カレンダー登録済も出力し、セル内の改行・カンマ・引用符に対応。JSON / CSV の読込はカレンダー登録済フラグを保つ（読込で二重エクスポートにならない）
- Googleドライブ同期のエラーは、HTTP 状態と原因（例: `accessNotConfigured` = Drive API が無効、401 = 許可の期限切れ）を表示

## ログインの仕組み

- **PC（ブラウザ）**: Firebase Auth の Google ポップアップで、その場で選んだアカウントにログインします。
- **Android**: `google-services.json` は使いません。システムのブラウザで、GitHub Pages 上のログイン用ページ（`auth.html`）を開きます。そこから Firebase 標準の `signInWithRedirect`（リダイレクト先は `https://abc-todo-planner-1b179.firebaseapp.com/__/auth/handler`）で Google の公式画面を表示し、選んだアカウントの ID トークンを端末内の `http://127.0.0.1:41827/auth/callback` 経由でアプリに戻し、`signInWithCredential` します。Google Cloud で Android アプリや SHA-1、OAuth のリダイレクト URI を追加する必要はありません。

## カレンダーへのエクスポート（Android のみ）

設定画面（右上の歯車）の「エクスポート」で、**完了したタスクだけ**を、端末内のカレンダー（Android の CalendarContract）に終日予定として書き込みます。Google アカウントのカレンダーを選べば、クラウドへの同期は端末の Google カレンダー側が行います。Google Calendar API や Google Cloud の設定は不要で、通信もしません（Web 版にはエクスポートはありません）。

- 権限: `READ_CALENDAR` / `WRITE_CALENDAR`（初回に許可ダイアログ）
- 登録先: 「カレンダーの種類（アカウント）」（Google アカウントごと／端末内（ローカル）／その他）を選び、その中のカレンダーを選ぶ。既定はログイン中のメールと同じ Google アカウントの主カレンダー。選択は端末に保存（v0.6.2〜）
- カレンダー名の入力: 名前（全角半角・大文字小文字は区別しない）で端末のカレンダーを選べる。無い場合は、Google カレンダーの「新しいカレンダーを作成」画面を開くボタンと手順を表示し、作成後「カレンダー一覧を再読込」（端末の各アカウントに同期を依頼）で取り込む。アプリから Google 側にカレンダーを作ることはしない（Google Calendar API の審査が必要な権限になるため）
- 同期オフのカレンダーは「同期をオンにする」ボタンで端末の同期・表示をオン（Google カレンダーアプリの設定と同じ項目）
- 予定名: `プレフィックス＋重要度＋緊急度＋タスク名＋（完了予定日）` 例: `［ToDo］A1 企画書を提出（2026/11/19）`。プレフィックスの既定は `［ToDo］`（v0.6.2〜。以前の既定値 `[ABC]` / `[ToDo]` のままなら自動で置き換え、変更していればそのまま）。「予定を探す」は以前の既定値の予定も対象
- 予定の日付: 完了日（未入力なら実施予定日）。終日予定（UTC 0:00〜翌日 0:00、タイムゾーン UTC）
- 予定の詳細: タスクの「メモ・詳細」だけ（カレンダーに目印などは書き込まない）
- 対象: 完了していて、まだ「エクスポート済みフラグ」が立っていないタスクだけ（v0.5.3〜）
- 登録に成功したタスクには `calendarExported: true` と `calendarExportedAt`（日時）を保存（Firestore で同期。端末に関係なく1回だけ登録）
- フラグが立ったタスクは、その後編集・削除しても、カレンダーの予定を更新・削除・検索しない（予定IDも保持しない）
- 翌日コピーなどで作られたタスクにはフラグを引き継がない
- v0.5.1 で説明欄に入れていた `abc-task:<ID>` の目印は、エクスポート時に選択カレンダー内の予定から取り除き、そのタスクをエクスポート済みにする（二重登録しない）
- 登録直後に、書き込んだ予定を読み直して日付・終日・カレンダーを確認。違っていればエラー表示。その後、そのアカウントの同期を依頼（v0.6.1〜）
- 設定の「エクスポート履歴」に直近 5 回分（登録先カレンダー名・アカウント・件数・日付）を表示（v0.6.1〜）
- 「このアプリが登録した予定を探す」: プレフィックスで始まる終日予定を一覧表示（日付・カレンダー・同期済みか）。チェックして確認ダイアログで「削除」したものだけ削除（自動では消さない。タスクのエクスポート済みフラグはそのまま）
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
