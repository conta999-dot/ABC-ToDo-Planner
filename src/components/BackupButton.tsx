import React, { useRef, useState, useEffect } from 'react';
import { Download, Upload } from 'lucide-react';
import { Task, PriorityLetter, TaskQuadrant } from '../types';
import { getLocalDateString, newTaskId } from '../lib/dates';
import { errorDetail } from '../lib/nativeGoogleAuth';
import { Capacitor } from '@capacitor/core';
import { saveTextFile } from '../lib/fileExport';
import {
  isAutoBackupAvailable,
  isAutoBackupEnabled,
  setAutoBackupEnabled,
  loadAutoBackupStatus,
  runAutoBackup,
  AutoBackupStatus,
  AUTO_BACKUP_FOLDER_LABEL,
  AUTO_BACKUP_KEEP,
} from '../lib/autoBackup';

interface BackupButtonProps {
  tasks: Task[];
  onImport: (importedTasks: Task[]) => void;
}

export default function BackupButton({ tasks, onImport }: BackupButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** エラーメッセージに生の詳細（コード等）を付けて表示する */
  const withDetail = (err: any, fallback: string) => {
    const msg = err?.message || fallback;
    const detail = err?.detail || errorDetail(err);
    return detail && detail !== msg ? `${msg}\n詳細: ${detail}` : msg;
  };

  // Android の自動バックアップ（1日1回）
  const [autoBackupOn, setAutoBackupOn] = useState<boolean>(() => isAutoBackupEnabled());
  const [backupStatus, setBackupStatus] = useState<AutoBackupStatus | null>(() => loadAutoBackupStatus());
  const [isBackingUp, setIsBackingUp] = useState(false);
  useEffect(() => {
    // App 側で自動バックアップが走ったら表示を更新
    const onDone = () => setBackupStatus(loadAutoBackupStatus());
    window.addEventListener('abc-auto-backup', onDone);
    return () => window.removeEventListener('abc-auto-backup', onDone);
  }, []);
  const handleToggleAutoBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAutoBackupOn(e.target.checked);
    setAutoBackupEnabled(e.target.checked);
    if (e.target.checked) {
      void runAutoBackup(tasks, { onlyIfDue: true }).then((st) => {
        if (st) setBackupStatus(st);
      });
    }
  };
  const handleBackupNow = async () => {
    setIsBackingUp(true);
    try {
      const st = await runAutoBackup(tasks, { force: true });
      if (st) setBackupStatus(st);
    } finally {
      setIsBackingUp(false);
    }
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
  const CSV_HEADERS = ['ID', 'タイトル', 'メモ', '優先度(英字)', '優先度(数字)', '領域', '期限', '通知時間', '通知有効', 'ステータス', '完了日時', '作成日時', '完了日', '更新日時', 'カレンダー登録済', 'カレンダー登録日時', 'タグID'];
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
      task.tagId || '',
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
        tagId: values[16] || prev?.tagId || undefined,
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
      {/* 1. Android の自動バックアップ（1日1回・端末内） */}
      {isAutoBackupAvailable() && (
        <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl" id="auto-backup-section">
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              id="auto-backup-checkbox"
              checked={autoBackupOn}
              onChange={handleToggleAutoBackup}
              className="w-4 h-4 border-zinc-300 rounded dark:border-zinc-700 dark:bg-zinc-900"
            />
            <label htmlFor="auto-backup-checkbox" className="text-[0.875rem] font-bold text-zinc-700 dark:text-zinc-200 cursor-pointer">
              1日1回、端末に自動バックアップする
            </label>
          </div>
          <div className="mt-2 text-[0.8125rem] font-semibold text-zinc-500 dark:text-zinc-400 leading-relaxed space-y-0.5">
            <div>保存先: {AUTO_BACKUP_FOLDER_LABEL}（ABCToDoPlanner_backup_年月日.json）</div>
            <div>その日はじめてアプリを開いたときに作成し、その日のうちにタスクを変えたら同じファイルを更新します。新しい{AUTO_BACKUP_KEEP}日分を残し、古いものは「old」フォルダへ移します（削除はしません）。</div>
            <div>戻すとき: 下の「読込 (JSON/CSV)」でバックアップのファイルを選びます。</div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.8125rem] font-semibold" id="auto-backup-status">
            <span className="text-zinc-500 dark:text-zinc-400">最終バックアップ:</span>
            <span className="text-zinc-800 dark:text-zinc-100 font-bold">
              {backupStatus ? `${new Date(backupStatus.at).toLocaleString('ja-JP')}（${backupStatus.fileName}・${backupStatus.count}件${backupStatus.movedToOld ? `・${backupStatus.movedToOld}件をoldへ移動` : ''}）` : 'まだありません'}
            </span>
            <button
              type="button"
              onClick={() => void handleBackupNow()}
              disabled={isBackingUp}
              className="px-3 py-1 rounded-lg text-xs font-bold border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 disabled:opacity-50"
              id="btn-backup-now"
            >
              {isBackingUp ? 'バックアップ中…' : '今すぐバックアップ'}
            </button>
          </div>
          {backupStatus?.error && (
            <div className="mt-2 p-2.5 rounded-lg text-sm font-semibold bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 whitespace-pre-wrap break-all">
              バックアップを保存できませんでした。{'\n'}詳細: {backupStatus.error}
            </div>
          )}
        </div>
      )}

      {/* 2. ローカルファイルとして保存・読込 */}
      <div className={isAutoBackupAvailable() ? 'pt-4 border-t border-zinc-200/50 dark:border-zinc-800' : ''} id="local-backup-section">
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
