import { Task } from '../types';

const BACKUP_FILE_NAME = 'abc_planner_backup.json';

export type DriveError = Error & { code?: string; detail?: string; status?: number; reason?: string };

/** Drive API のエラー応答から原因（HTTP 状態・reason）を取り出して、分かりやすいメッセージにする */
export async function toDriveError(response: Response, action: string): Promise<DriveError> {
  const raw = await response.text().catch(() => '');
  let reason = '';
  let apiMessage = '';
  try {
    const j = JSON.parse(raw);
    apiMessage = j?.error?.message || '';
    reason =
      j?.error?.errors?.[0]?.reason ||
      (j?.error?.details || []).find((d: { reason?: string }) => d?.reason)?.reason ||
      j?.error?.status ||
      '';
  } catch {
    apiMessage = raw.slice(0, 300);
  }
  const status = response.status;
  let message = `Google Driveの${action}に失敗しました。`;
  let code = 'DRIVE_FAILED';
  if (status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(reason + ' ' + apiMessage)) {
    code = 'DRIVE_API_DISABLED';
    message = `Google Driveの${action}に失敗しました。\n原因: このアプリの Google Cloud プロジェクトで「Google Drive API」が有効になっていません（アプリ側では直せない、サーバー側の設定です）。\nタスクのデータは Firestore のクラウド同期で端末間に同期されているので、日常の利用には影響ありません。`;
  } else if (status === 401) {
    code = 'DRIVE_UNAUTHORIZED';
    message = `Google Driveの${action}に失敗しました。\n原因: Googleドライブ用の許可（トークン）が無効か期限切れです。もう一度「今すぐ同期実行」を押し、表示されたGoogleの画面で許可してください。`;
  } else if (status === 403 && /insufficient|SCOPE/i.test(reason + ' ' + apiMessage)) {
    code = 'DRIVE_SCOPE';
    message = `Google Driveの${action}に失敗しました。\n原因: Googleドライブへのアクセスが許可されていません。もう一度「今すぐ同期実行」を押し、表示されたGoogleの画面で許可してください。`;
  } else if (status === 429 || /rateLimit|userRateLimit/i.test(reason)) {
    code = 'DRIVE_RATE_LIMIT';
    message = `Google Driveの${action}に失敗しました（短時間に操作が集中しました）。少し待ってからもう一度お試しください。`;
  }
  const e = new Error(message) as DriveError;
  e.code = code;
  e.status = status;
  e.reason = reason;
  e.detail = `HTTP ${status}${reason ? ` ${reason}` : ''}${apiMessage ? `: ${apiMessage}` : ''}`;
  console.error(`Google Drive ${action}エラー:`, e.detail);
  return e;
}

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
    throw await toDriveError(response, 'ファイル検索');
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
    throw await toDriveError(response, 'データ読み込み');
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
    throw await toDriveError(metadataResponse, 'ファイル作成');
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
    throw await toDriveError(response, 'データ更新');
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
