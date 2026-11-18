import { Task } from '../types';

const BACKUP_FILE_NAME = 'abc_planner_backup.json';

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
}

/**
 * Google Driveからバックアップファイルを検索する
 */
export async function findBackupFile(accessToken: string): Promise<DriveFileInfo | null> {
  const query = encodeURIComponent(`name = '${BACKUP_FILE_NAME}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google Driveファイル検索エラー:', errorText);
    throw new Error('Google Driveのファイル検索に失敗しました。');
  }

  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0] as DriveFileInfo;
  }
  return null;
}

/**
 * Google Driveからバックアップファイルの中身をダウンロードする
 */
export async function downloadBackupFile(accessToken: string, fileId: string): Promise<Task[]> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google Driveファイルダウンロードエラー:', errorText);
    throw new Error('Google Driveからのデータ読み込みに失敗しました。');
  }

  const text = await response.text();
  try {
    const tasks = JSON.parse(text);
    if (Array.isArray(tasks)) {
      return tasks as Task[];
    }
    return [];
  } catch (e) {
    console.error('JSONパースエラー (Google Drive上のファイル):', e);
    return [];
  }
}

/**
 * Google Driveに新しいバックアップファイルを作成する
 */
export async function createBackupFile(accessToken: string, tasks: Task[]): Promise<string> {
  // 1. メタデータの作成
  const metadataUrl = 'https://www.googleapis.com/drive/v3/files';
  const metadataResponse = await fetch(metadataUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: BACKUP_FILE_NAME,
      mimeType: 'application/json',
    }),
  });

  if (!metadataResponse.ok) {
    const errorText = await metadataResponse.text();
    console.error('Google Driveファイル作成(メタデータ)エラー:', errorText);
    throw new Error('Google Drive上のファイル作成に失敗しました。');
  }

  const fileInfo = await metadataResponse.json();
  const fileId = fileInfo.id;

  // 2. コンテンツのアップロード
  await updateBackupFile(accessToken, fileId, tasks);
  return fileId;
}

/**
 * Google Driveの既存のバックアップファイルを更新する
 */
export async function updateBackupFile(accessToken: string, fileId: string, tasks: Task[]): Promise<void> {
  const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;

  const response = await fetch(uploadUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tasks),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google Driveファイル更新エラー:', errorText);
    throw new Error('Google Drive上のデータの更新に失敗しました。');
  }
}

/**
 * ローカルタスクとGoogleドライブのタスクをマージ（同期）する
 * 1. 共通IDのタスクは updatedAt が新しい方を採用
 * 2. 片方にしかないタスクはそのまま追加
 */
export function mergeTasks(localTasks: Task[], driveTasks: Task[]): { merged: Task[]; updatedCount: number } {
  const mergedMap = new Map<string, Task>();
  let updatedCount = 0;

  // まずGoogle Driveのタスクをマップに追加
  driveTasks.forEach((task) => {
    mergedMap.set(task.id, task);
  });

  // 次にローカルのタスクをマージ
  localTasks.forEach((localTask) => {
    const driveTask = mergedMap.get(localTask.id);
    if (!driveTask) {
      // ドライブ側にまだ存在しないタスク
      mergedMap.set(localTask.id, localTask);
      updatedCount++;
    } else {
      // 両方に存在するタスク
      const localTime = new Date(localTask.updatedAt || localTask.createdAt || 0).getTime();
      const driveTime = new Date(driveTask.updatedAt || driveTask.createdAt || 0).getTime();

      if (localTime > driveTime) {
        // ローカルの方が新しい
        mergedMap.set(localTask.id, localTask);
        updatedCount++;
      } else if (driveTime > localTime) {
        // ドライブの方が新しい
        updatedCount++;
      }
      // 同じ場合はそのままドライブ側のタスク（同一内容）にしておく
    }
  });

  return {
    merged: Array.from(mergedMap.values()),
    updatedCount,
  };
}
