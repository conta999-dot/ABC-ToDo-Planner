import { Capacitor } from '@capacitor/core';
import { GoogleAuthProvider, reauthenticateWithPopup, signInWithPopup } from 'firebase/auth';
import { Task } from '../types';
import { auth } from './firebase';
import { NativeGoogleAuth, errorDetail } from './nativeGoogleAuth';
import { addDays } from './dates';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
/** アプリが作った予定の目印（extendedProperties.private） */
const APP_MARK_KEY = 'abcTodoPlanner';
const TASK_ID_KEY = 'abcTaskId';

export const CALENDAR_PREFIX_STORAGE_KEY = 'abc_calendar_prefix';
export const DEFAULT_CALENDAR_PREFIX = '[ABC]';

export class CalendarError extends Error {
  detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.detail = detail;
  }
}

/** YYYY-MM-DD → YYYY/MM/DD */
const slashDate = (d: string) => d.replace(/-/g, '/');

/** 予定のタイトル: プレフィックス＋重要度＋緊急度＋タスク名＋（完了予定日） */
export const buildEventTitle = (task: Pick<Task, 'title' | 'priorityLetter' | 'priorityNumber' | 'dueDate'>, prefix: string): string => {
  const priority = `${task.priorityLetter || ''}${task.priorityNumber ?? ''}`;
  const head = `${prefix}${priority}`;
  const name = (task.title || '').trim();
  const due = task.dueDate ? `（${slashDate(task.dueDate)}）` : '';
  return `${head}${head && name ? ' ' : ''}${name}${due}`;
};

/** 予定の日付: 完了日があれば完了日、なければ実施予定日（完了予定日） */
export const eventDateOf = (task: Task): string => task.completedDate || task.dueDate || (task.completedAt ? task.completedAt.slice(0, 10) : '');

export const exportableTasks = (tasks: Task[]): Task[] =>
  tasks.filter((t) => t.status === 'completed' && !!eventDateOf(t) && !!(t.title || '').trim());

// ---------------- アクセストークン ----------------
let webToken: { token: string; expiresAt: number } | null = null;

const getCalendarAccessToken = async (): Promise<string> => {
  if (!auth.currentUser) {
    throw new CalendarError('Googleアカウントでログインしてからエクスポートしてください。', 'not-signed-in');
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const { accessToken } = await NativeGoogleAuth.authorize({ scopes: [CALENDAR_SCOPE], interactive: true });
      return accessToken;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const msg =
        code === 'CANCELLED'
          ? 'Googleカレンダーへのアクセス許可がキャンセルされました。'
          : code === 'MISCONFIGURED'
            ? 'Googleカレンダーの許可画面を開けませんでした（Google Cloud の設定を確認してください）。'
            : 'Googleカレンダーへのアクセス許可を取得できませんでした。';
      throw new CalendarError(msg, `[カレンダー許可] ${errorDetail(error)}`);
    }
  }
  if (webToken && webToken.expiresAt > Date.now() + 60_000) return webToken.token;
  const provider = new GoogleAuthProvider();
  provider.addScope(CALENDAR_SCOPE);
  provider.setCustomParameters({ login_hint: auth.currentUser.email || '' });
  try {
    let result;
    try {
      result = await reauthenticateWithPopup(auth.currentUser, provider);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? '';
      if (code === 'auth/user-mismatch') {
        throw new CalendarError(
          `ログイン中のアカウント（${auth.currentUser.email}）と違うアカウントが選ばれました。同じアカウントを選んでください。`,
          `[カレンダー許可] ${errorDetail(error)}`,
        );
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        throw new CalendarError('Googleカレンダーへのアクセス許可がキャンセルされました。', `[カレンダー許可] ${errorDetail(error)}`);
      }
      if (code === 'auth/popup-blocked') {
        throw new CalendarError('許可画面のポップアップがブロックされました。ブラウザのポップアップ許可を確認してください。', `[カレンダー許可] ${errorDetail(error)}`);
      }
      if (code === 'auth/requires-recent-login' || code === 'auth/user-token-expired') {
        result = await signInWithPopup(auth, provider);
      } else {
        throw error;
      }
    }
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new CalendarError('Googleカレンダーのアクセストークンを取得できませんでした。', 'no-access-token');
    webToken = { token, expiresAt: Date.now() + 50 * 60_000 };
    return token;
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError('Googleカレンダーへのアクセス許可を取得できませんでした。', `[カレンダー許可] ${errorDetail(error)}`);
  }
};

// ---------------- API ----------------
interface CalEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

const apiError = async (res: Response, stage: string): Promise<CalendarError> => {
  const text = await res.text().catch(() => '');
  let reason = '';
  let message = '';
  try {
    const j = JSON.parse(text);
    message = j?.error?.message || '';
    reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
    const infoReason = (j?.error?.details || []).find((d: { reason?: string }) => d?.reason)?.reason;
    if (infoReason) reason = `${reason}/${infoReason}`;
  } catch {
    message = text.slice(0, 300);
  }
  const detail = `[${stage}] status=${res.status} ${reason} ${message}`.trim();
  let friendly = `Googleカレンダーとの通信に失敗しました（${res.status}）。`;
  if (res.status === 401) friendly = 'Googleカレンダーの許可の有効期限が切れました。もう一度エクスポートしてください。';
  if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(text)) {
    friendly = 'Google Cloud で「Google Calendar API」が有効になっていません。設定手順に沿って有効にしてから、もう一度お試しください。';
  } else if (res.status === 403 && /insufficient|scope/i.test(text)) {
    friendly = 'Googleカレンダーへの書き込み許可がありません。許可画面で「カレンダーの予定の表示と編集」にチェックを入れてください。';
  } else if (res.status === 403 && /rateLimit|quota/i.test(text)) {
    friendly = 'Googleカレンダーの利用回数の上限に達しました。少し時間をおいてから、もう一度お試しください。';
  }
  if (res.status === 401) webToken = null;
  return new CalendarError(friendly, detail);
};

const listAppEvents = async (token: string): Promise<Map<string, CalEvent>> => {
  const map = new Map<string, CalEvent>();
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      privateExtendedProperty: `${APP_MARK_KEY}=1`,
      maxResults: '2500',
      singleEvents: 'false',
      showDeleted: 'false',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`${API}?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await apiError(res, '既存予定の確認');
    const data = await res.json();
    for (const ev of (data.items || []) as CalEvent[]) {
      const tid = ev.extendedProperties?.private?.[TASK_ID_KEY];
      if (tid && !map.has(tid)) map.set(tid, ev);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return map;
};

export interface ExportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/** 完了タスクを Google カレンダー（メイン）に終日予定として登録・更新する */
export const exportCompletedTasksToCalendar = async (
  tasks: Task[],
  prefix: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> => {
  const targets = exportableTasks(tasks);
  const token = await getCalendarAccessToken();
  const existing = await listAppEvents(token);
  const result: ExportResult = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  let done = 0;
  for (const task of targets) {
    const date = eventDateOf(task);
    const body = {
      summary: buildEventTitle(task, prefix),
      description: (task.notes || '').trim(),
      start: { date },
      end: { date: addDays(date, 1) },
      transparency: 'transparent',
      extendedProperties: { private: { [APP_MARK_KEY]: '1', [TASK_ID_KEY]: task.id } },
    };
    const ev = existing.get(task.id);
    try {
      if (ev) {
        const same =
          (ev.summary || '') === body.summary &&
          (ev.description || '') === body.description &&
          ev.start?.date === date;
        if (same) {
          result.skipped += 1;
        } else {
          const res = await fetch(`${API}/${encodeURIComponent(ev.id)}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw await apiError(res, '予定の更新');
          result.updated += 1;
        }
      } else {
        const res = await fetch(API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw await apiError(res, '予定の登録');
        result.created += 1;
      }
    } catch (error) {
      // API 無効・権限なしなど全件に共通するエラーは即中断
      if (error instanceof CalendarError && /status=(401|403)/.test(error.detail) && result.created + result.updated === 0) {
        throw error;
      }
      result.failed += 1;
      result.errors.push(`${task.title}: ${error instanceof CalendarError ? error.detail : errorDetail(error)}`);
    }
    done += 1;
    onProgress?.(done, targets.length);
  }
  return result;
};
