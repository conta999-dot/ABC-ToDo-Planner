import React, { useRef, useState, useEffect } from 'react';
import { Download, Upload, Cloud, RefreshCw, LogOut, CheckCircle, ShieldAlert } from 'lucide-react';
import { Task, PriorityLetter, TaskQuadrant } from '../types';
import { getLocalDateString, newTaskId } from '../lib/dates';
import { initAuth, googleSignIn, logout as googleLogout, getAccessToken, clearDriveToken } from '../lib/firebase';
import { errorDetail } from '../lib/nativeGoogleAuth';
import { findBackupFile, downloadBackupFile, createBackupFile, updateBackupFile, mergeTasks } from '../lib/drive';
import { User } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { saveTextFile } from '../lib/fileExport';

interface BackupButtonProps {
  tasks: Task[];
  onImport: (importedTasks: Task[]) => void;
}

export default function BackupButton({ tasks, onImport }: BackupButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(() => {
    return localStorage.getItem('abc_planner_drive_last_sync_time');
  });
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    const saved = localStorage.getItem('abc_planner_drive_auto_sync_enabled');
    return saved !== 'false'; // デフォルトは有効
  });
  const [syncError, setSyncError] = useState<string | null>(null);
  /** エラーメッセージに生の詳細（コード等）を付けて表示する */
  const withDetail = (err: any, fallback: string) => {
    const msg = err?.message || fallback;
    const detail = err?.detail || errorDetail(err);
    return detail && detail !== msg ? `${msg}\n詳細: ${detail}` : msg;
  };
  const [syncSuccess, setSyncSuccess] = useState<boolean>(false);

  // 自動同期の無限ループ防止用。最後に処理したタスク配列のJSON文字列
  const lastProcessedTasksJson = useRef<string>('');
  // Drive API が使えない（サーバー側の設定）と分かったら、自動同期はこのセッション中は試さない
  const driveUnavailable = useRef(false);
  const noteDriveError = (err: any) => {
    if (err?.code === 'DRIVE_UNAUTHORIZED') clearDriveToken();
    if (err?.code === 'DRIVE_API_DISABLED') driveUnavailable.current = true;
  };

  // 1. Authの初期化
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, _token) => {
        setUser(currentUser);
      },
      () => {
        setUser(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // 2. タスクが変化した際の自動同期（自動保存）
  useEffect(() => {
    if (!user || !autoSync || isSyncing || driveUnavailable.current) return;

    const currentTasksJson = JSON.stringify(tasks);
    // すでに処理済み、または同期等により渡されたタスクと全く同一であれば何もしない
    if (currentTasksJson === lastProcessedTasksJson.current) {
      return;
    }

    // 初回のマウント時は自動同期を行わない（読み込み時に上書きされるのを防ぐ）
    if (lastProcessedTasksJson.current === '') {
      lastProcessedTasksJson.current = currentTasksJson;
      return;
    }

    // debounce して自動保存する
    const timer = setTimeout(async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        setIsSyncing(true);
        setSyncError(null);

        // ドライブ上のファイルを取得
        const driveFile = await findBackupFile(token);
        if (driveFile) {
          // ドライブ上のファイルがある場合は、マージしてからアップロードする
          const driveTasks = await downloadBackupFile(token, driveFile.id);
          const { merged } = mergeTasks(tasks, driveTasks);
          
          await updateBackupFile(token, driveFile.id, merged);
          
          // マージされた結果が現在のローカルと異なれば、インポートコールバックで親に通知
          if (JSON.stringify(merged) !== currentTasksJson) {
            onImport(merged);
            lastProcessedTasksJson.current = JSON.stringify(merged);
          } else {
            lastProcessedTasksJson.current = currentTasksJson;
          }
        } else {
          // ドライブ上にまだファイルがない場合は新しく作成
          await createBackupFile(token, tasks);
          lastProcessedTasksJson.current = currentTasksJson;
        }

        const nowStr = new Date().toLocaleString('ja-JP');
        setLastSyncTime(nowStr);
        localStorage.setItem('abc_planner_drive_last_sync_time', nowStr);
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 3000);
      } catch (err: any) {
        console.error('自動同期エラー:', err);
        noteDriveError(err);
        setSyncError(withDetail(err, '自動同期中にエラーが発生しました。'));
      } finally {
        setIsSyncing(false);
      }
    }, 2000); // 2秒間変更がなければ同期を実行

    return () => clearTimeout(timer);
  }, [tasks, user, autoSync, onImport]);

  // Google ログイン処理
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setSyncError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        const driveToken = result.accessToken ?? (await getAccessToken({ interactive: true }).catch(() => null));
        if (driveToken) {
          await handleSync(driveToken);
        } else {
          setSyncError('ログインは成功しましたが、Googleドライブ用のトークンがありません。クラウド同期は利用できます。ドライブバックアップは「今すぐ同期実行」を押して、表示されたGoogleの画面で許可してください。');
        }
      }
    } catch (err: any) {
      console.error('ログイン失敗:', err);
      setSyncError(withDetail(err, 'Googleログインに失敗しました。'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  // ログアウト処理
  const handleLogout = async () => {
    if (window.confirm('Googleアカウントからログアウトしますか？ ログアウトしてもローカルデータはそのまま残ります。')) {
      try {
        await googleLogout();
        setUser(null);
        setSyncError(null);
      } catch (err: any) {
        console.error('ログアウト失敗:', err);
      }
    }
  };

  // 手動同期処理
  const handleManualSync = async () => {
    driveUnavailable.current = false;
    try {
      const token = await getAccessToken({ interactive: true });
      if (!token) {
        throw new Error('Googleドライブ用の許可がありません。表示されたGoogleの画面で許可してください。');
      }
      await handleSync(token);
    } catch (err: any) {
      setSyncError(withDetail(err, 'Googleドライブの許可に失敗しました。'));
    }
  };

  // 共通の同期処理
  const handleSync = async (token: string) => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncSuccess(false);

    try {
      // 1. ドライブ側のファイルを検索
      const driveFile = await findBackupFile(token);

      if (driveFile) {
        // 2. ドライブにバックアップファイルが存在する場合、ダウンロードしてマージ
        const driveTasks = await downloadBackupFile(token, driveFile.id);
        const { merged, updatedCount } = mergeTasks(tasks, driveTasks);

        // 3. マージした結果、更新があればローカルとクラウドを両方最新に
        await updateBackupFile(token, driveFile.id, merged);
        
        // メモリ状態を更新して、自動同期が再度トリガーされるのを防ぐ
        const mergedJson = JSON.stringify(merged);
        lastProcessedTasksJson.current = mergedJson;

        onImport(merged);

        if (updatedCount > 0) {
          alert(`Googleドライブと同期完了しました！\n双方の変更を統合し、タスクを最新状態にマージしました。`);
        } else {
          setSyncSuccess(true);
          setTimeout(() => setSyncSuccess(false), 3000);
        }
      } else {
        // 4. バックアップファイルが存在しない場合、新規作成
        await createBackupFile(token, tasks);
        lastProcessedTasksJson.current = JSON.stringify(tasks);
        alert('Googleドライブに最初のバックアップデータを作成しました。');
      }

      const nowStr = new Date().toLocaleString('ja-JP');
      setLastSyncTime(nowStr);
      localStorage.setItem('abc_planner_drive_last_sync_time', nowStr);
    } catch (err: any) {
      console.error('同期エラー:', err);
      noteDriveError(err);
      setSyncError(withDetail(err, 'データの同期中にエラーが発生しました。'));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleAutoSync = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setAutoSync(checked);
    localStorage.setItem('abc_planner_drive_auto_sync_enabled', String(checked));
  };

  const [fileMessage, setFileMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const stamp = () => {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${getLocalDateString()}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  };

  const saveFile = async (fileName: string, text: string, mime: string) => {
    setFileMessage(null);
    try {
      const r = await saveTextFile(fileName, text, mime);
      if (r.savedPath) {
        setFileMessage({ ok: true, text: `保存しました: ${r.savedPath}${r.shared ? '\n（共有メニューから Googleドライブ・メール等にも保存できます）' : ''}` });
      } else if (r.shared) {
        setFileMessage({ ok: true, text: `共有メニューを開きました（${fileName}）。保存先（ドライブ・ファイル等）を選んでください。` });
      } else {
        setFileMessage({ ok: true, text: `${fileName} をダウンロードしました。` });
      }
    } catch (e: any) {
      setFileMessage({ ok: false, text: withDetail(e, 'ファイルを保存できませんでした。') });
    }
  };

  // JSON Export（全項目そのまま。読込で完全に戻せる）
  const handleExportJSON = () => {
    void saveFile(`abc_planner_tasks_${stamp()}.json`, JSON.stringify(tasks, null, 2), 'application/json');
  };

  // CSV Export（Excel 互換。読込時に元へ戻せるよう完了日・更新日時・カレンダー登録済も出力）
  const CSV_HEADERS = ['ID', 'タイトル', 'メモ', '優先度(英字)', '優先度(数字)', '領域', '期限', '通知時間', '通知有効', 'ステータス', '完了日時', '作成日時', '完了日', '更新日時', 'カレンダー登録済', 'カレンダー登録日時'];
  const handleExportCSV = () => {
    const rows = tasks.map((task) => [
      task.id,
      task.title,
      task.notes || '',
      task.priorityLetter || '',
      task.priorityNumber ?? '',
      task.quadrant,
      task.dueDate,
      task.reminderTime || '',
      task.reminderEnabled ? '1' : '0',
      task.status || 'pending',
      task.completedAt || '',
      task.createdAt,
      task.completedDate || '',
      task.updatedAt || '',
      task.calendarExported ? '1' : '0',
      task.calendarExportedAt || '',
    ]);
    const csvContent = [
      CSV_HEADERS.join(','),
      ...rows.map((row) => row.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')),
    ].join('\r\n');
    void saveFile(`abc_planner_tasks_${stamp()}.csv`, '\uFEFF' + csvContent, 'text/csv;charset=utf-8');
  };

  /** CSV を行・列に分解（"" のエスケープ、セル内の改行・カンマに対応） */
  const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
        } else cell += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((v) => v !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((v) => v !== '')) rows.push(row);
    return rows;
  };

  const VALID_STATUS = ['pending', 'in_progress', 'completed', 'postponed', 'delegated', 'deleted'];

  const importFromText = (rawText: string, fileName: string) => {
    const text = rawText.replace(/^\uFEFF/, '');
    const trimmed = text.trimStart();
    const existing = new Map(tasks.map((t) => [t.id, t] as const));
    const nowIso = new Date().toISOString();
    if (trimmed.startsWith('[') || trimmed.startsWith('{') || /\.json$/i.test(fileName)) {
      const parsedRaw = JSON.parse(trimmed);
      const parsed = (Array.isArray(parsedRaw) ? parsedRaw : Array.isArray(parsedRaw?.tasks) ? parsedRaw.tasks : null) as Task[] | null;
      if (!parsed) {
        setFileMessage({ ok: false, text: '無効なJSONフォーマットです（タスクの配列ではありません）。' });
        return;
      }
      const validTasks: Task[] = parsed.map((t) => {
        const status = (t.status || (t.completed ? 'completed' : 'pending')) as Task['status'];
        return {
          ...t, // 完了日・エクスポート済みフラグなど、すべての項目をそのまま引き継ぐ
          id: t.id || newTaskId(),
          userId: t.userId || 'local-user',
          title: t.title || '無題のタスク',
          notes: t.notes || '',
          priorityLetter: (t.priorityLetter || '') as PriorityLetter,
          priorityNumber: t.priorityNumber ?? null,
          quadrant: (t.quadrant || 'IV') as TaskQuadrant,
          dueDate: t.dueDate || getLocalDateString(),
          reminderTime: t.reminderTime || '',
          reminderEnabled: !!t.reminderEnabled,
          reminderNotified: !!t.reminderNotified,
          completed: status === 'completed',
          status,
          completedAt: t.completedAt || null,
          createdAt: t.createdAt || nowIso,
          updatedAt: t.updatedAt || nowIso,
          calendarExported: !!(t.calendarExported || existing.get(t.id)?.calendarExported) || undefined,
          calendarExportedAt: t.calendarExportedAt || existing.get(t.id)?.calendarExportedAt,
        };
      });
      onImport(validTasks);
      setFileMessage({ ok: true, text: `${validTasks.length}個のタスクを読み込みました（同じIDのタスクは更新日時が新しい方を残します）。` });
      return;
    }

    const rows = parseCSV(text);
    if (rows.length <= 1) {
      setFileMessage({ ok: false, text: 'CSVファイルが空か、ヘッダーのみです。' });
      return;
    }
    const imported: Task[] = [];
    for (const values of rows.slice(1)) {
      if (values.length < 2) continue;
      const id = values[0] || newTaskId();
      const prev = existing.get(id);
      const num = values[4] ? parseInt(values[4], 10) : NaN;
      const status = (VALID_STATUS.includes(values[9]) ? values[9] : 'pending') as Task['status'];
      const letter = (['A', 'B', 'C'].includes(values[3]) ? values[3] : '') as PriorityLetter;
      const csvExported = values[14] === '1';
      imported.push({
        ...(prev || {}),
        id,
        userId: prev?.userId || 'local-user',
        title: values[1] || '無題のタスク',
        notes: values[2] || '',
        priorityLetter: letter,
        priorityNumber: Number.isNaN(num) ? null : num,
        quadrant: (['I', 'II', 'III', 'IV'].includes(values[5]) ? values[5] : 'IV') as TaskQuadrant,
        dueDate: values[6] || getLocalDateString(),
        reminderTime: values[7] || '',
        reminderEnabled: values[8] === '1',
        reminderNotified: prev?.reminderNotified ?? false,
        completed: status === 'completed',
        status,
        completedAt: values[10] || null,
        createdAt: values[11] || prev?.createdAt || nowIso,
        completedDate: values[12] || prev?.completedDate,
        updatedAt: values[13] || nowIso,
        calendarExported: csvExported || prev?.calendarExported || undefined,
        calendarExportedAt: values[15] || prev?.calendarExportedAt,
      } as Task);
    }
    if (imported.length > 0) {
      onImport(imported);
      setFileMessage({ ok: true, text: `${imported.length}個のタスクをCSVから読み込みました。` });
    } else {
      setFileMessage({ ok: false, text: '読み込める行が見つかりませんでした。' });
    }
  };

  // Handle File Import (JSON or CSV)
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileMessage(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        importFromText(String(event.target?.result ?? ''), file.name || '');
      } catch (err) {
        console.error('Import error:', err);
        setFileMessage({ ok: false, text: '読み込みに失敗しました。JSON または CSV（このアプリで書き出したもの）を選んでください。' });
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onerror = () => setFileMessage({ ok: false, text: 'ファイルを読み取れませんでした。' });
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6" id="backup-container">
      {/* 1. Google Drive 同期機能 */}
      <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl" id="google-drive-sync-section">
        <div className="flex items-center gap-2 mb-3">
          <Cloud className="w-5 h-5 text-indigo-500" />
          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
            Googleドライブ同期 (クラウドバックアップ・端末間連携)
          </span>
        </div>

        {!user ? (
          <div>
            <p className="text-[0.875rem] text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed font-semibold">
              Googleアカウントでログインすると、お使いのGoogleドライブに暗号化された安全なバックアップファイルが保存され、他のスマートフォンやPCと自動で双方向同期できます。
            </p>
            
            <button
              onClick={handleGoogleLogin}
              disabled={isLoggingIn}
              className="inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-bold transition-all shadow-xs w-full sm:w-auto active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
              id="google-signin-btn"
            >
              <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
              </svg>
              <span>{isLoggingIn ? 'サインイン中...' : 'Googleアカウントでサインイン'}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-lg">
              <div className="flex items-center gap-2.5">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User'}
                    className="w-8 h-8 rounded-full border border-zinc-200"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-600 dark:text-zinc-300">
                    {user.displayName?.[0] || user.email?.[0] || 'G'}
                  </div>
                )}
                <div>
                  <div className="text-[0.875rem] font-bold text-zinc-800 dark:text-zinc-200 leading-tight">
                    {user.displayName || 'ログイン中のユーザー'}
                  </div>
                  <div className="text-[0.75rem] font-semibold text-zinc-500 dark:text-zinc-400 leading-none">
                    {user.email}
                  </div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[0.8125rem] font-bold text-zinc-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 dark:text-zinc-400 rounded-md border border-zinc-200 dark:border-zinc-800 hover:border-red-200 dark:hover:border-red-500/20 transition-all self-start sm:self-center"
                id="btn-google-signout"
              >
                <LogOut className="w-3 h-3" />
                <span>サインアウト</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem] font-semibold text-zinc-500">
              <div className="flex items-center gap-1">
                <span>最終同期日時:</span>
                <span className="text-zinc-700 dark:text-zinc-300 font-bold">
                  {lastSyncTime || '未同期'}
                </span>
              </div>
              {syncSuccess && (
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>同期完了</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-zinc-200/50 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  id="auto-sync-checkbox"
                  checked={autoSync}
                  onChange={handleToggleAutoSync}
                  className="w-4 h-4 text-indigo-600 border-zinc-300 rounded focus:ring-indigo-500 dark:border-zinc-800 dark:bg-zinc-900"
                />
                <label htmlFor="auto-sync-checkbox" className="text-[0.875rem] font-bold text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  タスク変更時に自動同期する (バックアップ)
                </label>
              </div>

              <button
                onClick={handleManualSync}
                disabled={isSyncing}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-extrabold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                id="btn-manual-sync"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? '同期中...' : '今すぐ同期実行'}</span>
              </button>
            </div>
          </div>
        )}

        {syncError && (
          <div className="mt-3 flex items-start gap-1.5 p-2.5 bg-red-50 dark:bg-red-500/10 border border-red-200/50 dark:border-red-500/20 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="whitespace-pre-wrap break-all select-text">{syncError}</span>
          </div>
        )}
      </div>

      {/* 2. 従来のローカルファイルバックアップ機能 */}
      <div className="pt-4 border-t border-zinc-200/50 dark:border-zinc-800" id="local-backup-section">
        <h4 className="text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 mb-3.5 uppercase tracking-wider">
          ローカルファイルとして保存・読込
        </h4>
        <div className="flex flex-wrap gap-2 items-center" id="backup-controls">
          <button
            onClick={handleExportJSON}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            title="全タスクをJSON形式でダウンロード"
            id="btn-export-json"
          >
            <Download className="w-3.5 h-3.5" />
            JSON書出
          </button>
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            title="全タスクをExcel互換のCSV形式でダウンロード"
            id="btn-export-csv"
          >
            <Download className="w-3.5 h-3.5" />
            CSV書出
          </button>
          <label
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
            title="JSONまたはCSVファイルを読み込む"
            id="lbl-import-file"
          >
            <Upload className="w-3.5 h-3.5" />
            読込 (JSON/CSV)
            <input
              ref={fileInputRef}
              type="file"
              accept={Capacitor.isNativePlatform() ? 'application/json,text/csv,text/comma-separated-values,text/plain,application/octet-stream,*/*' : '.json,.csv,application/json,text/csv'}
              onChange={handleImportFile}
              className="hidden"
              id="file-import-input"
            />
          </label>
        </div>
        {fileMessage && (
          <div
            className={`mt-3 p-2.5 rounded-lg text-sm font-semibold whitespace-pre-wrap break-all ${fileMessage.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'}`}
            id="local-file-message"
          >
            {fileMessage.text}
          </div>
        )}
        {Capacitor.isNativePlatform() && (
          <p className="mt-2 text-[0.8125rem] font-semibold text-zinc-500 dark:text-zinc-400">
            書出: 端末の「ドキュメント/ABCToDoPlanner」に保存し、続けて共有メニューが開きます（Googleドライブやメールにも保存できます）。読込: ファイル選択画面で JSON / CSV を選びます。
          </p>
        )}
      </div>
    </div>
  );
}
