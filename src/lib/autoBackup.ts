import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Task } from '../types';

/**
 * Android の自動バックアップ（1日1ファイル）
 * - 保存先: 端末の「ドキュメント/ABCToDoPlanner/ABCToDoPlanner_backup_YYYYMMDD.json」
 * - 中身は「JSON書出」と同じ形式（全項目。完了日・カレンダー登録済フラグも含む）なので「読込」でそのまま戻せる
 * - その日の初回起動・復帰時に作成し、その日のうちにタスクが変わったら同じファイルを上書き（1日1ファイル）
 * - 新しい 7 日分を残し、それより古いファイルは old フォルダへ移動（削除はしない）
 * - サーバー側の設定は不要（端末内に保存するだけ）。Web 版では動かない
 */
export const AUTO_BACKUP_DIR = 'ABCToDoPlanner';
export const AUTO_BACKUP_OLD_DIR = `${AUTO_BACKUP_DIR}/old`;
export const AUTO_BACKUP_FOLDER_LABEL = 'ドキュメント/ABCToDoPlanner';
export const AUTO_BACKUP_KEEP = 7;
const FILE_RE = /^ABCToDoPlanner_backup_(\d{8})\.json$/;

const ENABLED_KEY = 'abc_auto_backup_enabled';
const LAST_KEY = 'abc_auto_backup_last';

export interface AutoBackupStatus {
  at: string;        // ISO
  fileName: string;
  count: number;
  movedToOld: number;
  error?: string;
}

export const isAutoBackupAvailable = () => Capacitor.getPlatform() === 'android';

export const isAutoBackupEnabled = (): boolean => {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const setAutoBackupEnabled = (on: boolean) => {
  try {
    localStorage.setItem(ENABLED_KEY, String(on));
  } catch {
    // ignore
  }
};

export const loadAutoBackupStatus = (): AutoBackupStatus | null => {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as AutoBackupStatus) : null;
  } catch {
    return null;
  }
};

const saveStatus = (s: AutoBackupStatus) => {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
};

const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export const backupFileNameFor = (d = new Date()) => `ABCToDoPlanner_backup_${ymd(d)}.json`;

/** 今日のバックアップがまだなら true */
export const isBackupDueToday = (): boolean => {
  const last = loadAutoBackupStatus();
  return !last || last.error !== undefined || last.fileName !== backupFileNameFor();
};

/** 新しい 7 日分を残し、それより古いバックアップを old フォルダへ移動する（削除しない） */
const rotateOldBackups = async (): Promise<number> => {
  const { files } = await Filesystem.readdir({ path: AUTO_BACKUP_DIR, directory: Directory.Documents });
  const names = files
    .map((f) => (typeof f === 'string' ? f : f.name))
    .filter((n) => FILE_RE.test(n))
    .sort()
    .reverse();
  const toMove = names.slice(AUTO_BACKUP_KEEP);
  if (toMove.length === 0) return 0;
  try {
    await Filesystem.mkdir({ path: AUTO_BACKUP_OLD_DIR, directory: Directory.Documents, recursive: true });
  } catch {
    // すでにある
  }
  let moved = 0;
  for (const name of toMove) {
    try {
      let target = `${AUTO_BACKUP_OLD_DIR}/${name}`;
      // old に同名があれば上書きせず別名にする
      try {
        await Filesystem.stat({ path: target, directory: Directory.Documents });
        target = `${AUTO_BACKUP_OLD_DIR}/${name.replace(/\.json$/, '')}_${Date.now()}.json`;
      } catch {
        // 同名なし
      }
      await Filesystem.rename({ from: `${AUTO_BACKUP_DIR}/${name}`, to: target, directory: Directory.Documents, toDirectory: Directory.Documents });
      moved++;
    } catch (e) {
      console.warn('古いバックアップを old へ移動できませんでした:', name, e);
    }
  }
  return moved;
};

/**
 * 今日のバックアップを書く（同じ日のファイルは上書き）。
 * force=false のときは、自動バックアップがオフ、または今日すでに書いていれば何もしない。
 */
export const runAutoBackup = async (tasks: Task[], options: { force?: boolean; onlyIfDue?: boolean } = {}): Promise<AutoBackupStatus | null> => {
  if (!isAutoBackupAvailable()) return null;
  if (!options.force && !isAutoBackupEnabled()) return null;
  if (options.onlyIfDue && !isBackupDueToday()) return null;
  const fileName = backupFileNameFor();
  const status: AutoBackupStatus = { at: new Date().toISOString(), fileName, count: tasks.length, movedToOld: 0 };
  try {
    await Filesystem.writeFile({
      path: `${AUTO_BACKUP_DIR}/${fileName}`,
      data: JSON.stringify(tasks, null, 2),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    try {
      status.movedToOld = await rotateOldBackups();
    } catch (e) {
      console.warn('バックアップの整理（old への移動）に失敗:', e);
    }
  } catch (e) {
    status.error = (e as { message?: string })?.message || String(e);
  }
  saveStatus(status);
  return status;
};
