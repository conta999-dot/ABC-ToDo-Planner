import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PermissionState } from '@capacitor/core';
import { Task, CalendarExportRecord } from '../types';
import { errorDetail } from './nativeGoogleAuth';

/**
 * 完了タスクを Android 端末内のカレンダー（CalendarContract）へ終日予定として書き込む。
 * Google アカウントのカレンダーを選べば、クラウドへの同期は端末の Google カレンダー側が行う。
 * Web 版ではエクスポートは使えない（Google Calendar API は使わない）。
 */

export interface DeviceCalendarInfo {
  id: string;
  displayName: string;
  accountName: string;
  accountType: string;
  isPrimary: boolean;
  color: string | null;
  visible: boolean;
}

export interface UpsertResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface UpsertItemResult {
  taskId: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  eventId?: string;
  error?: string;
}

interface DeviceCalendarPlugin {
  checkPermissions(): Promise<{ calendar: PermissionState }>;
  requestPermissions(): Promise<{ calendar: PermissionState }>;
  openAppSettings(): Promise<void>;
  listCalendars(): Promise<{ calendars: DeviceCalendarInfo[] }>;
  upsertEvents(options: {
    calendarId: string;
    events: { taskId: string; title: string; description: string; date: string; eventId?: string; changed: boolean }[];
  }): Promise<{ results: UpsertItemResult[] }>;
  cleanLegacyMarkers(options: { calendarId: string }): Promise<{ adopted: { taskId: string; eventId: string }[] }>;
}

const DeviceCalendar = registerPlugin<DeviceCalendarPlugin>('DeviceCalendar');

export const isCalendarExportAvailable = () => Capacitor.getPlatform() === 'android';

export const CALENDAR_PREFIX_STORAGE_KEY = 'abc_calendar_prefix';
export const CALENDAR_ID_STORAGE_KEY = 'abc_calendar_id';
export const DEFAULT_CALENDAR_PREFIX = '[ABC]';

export const PERMISSION_GUIDE =
  'カレンダーへのアクセスが許可されていません。次の手順で許可してから、もう一度お試しください。\n' +
  '1. Android の「設定」アプリを開く\n' +
  '2.「アプリ」をタップ（機種により「アプリと通知」）\n' +
  '3. 一覧から「ABC ToDo Planner」をタップ（見つからなければ「○○個のアプリをすべて表示」をタップ）\n' +
  '4.「権限」をタップ\n' +
  '5.「カレンダー」をタップ\n' +
  '6.「許可」を選ぶ';

export class CalendarError extends Error {
  detail: string;
  code: string;
  constructor(message: string, detail: string, code = 'FAILED') {
    super(message);
    this.detail = detail;
    this.code = code;
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
  tasks.filter((t) => t.status === 'completed' && /^\d{4}-\d{2}-\d{2}$/.test(eventDateOf(t)) && !!(t.title || '').trim());

const toCalendarError = (error: unknown, stage: string): CalendarError => {
  const code = (error as { code?: string } | null)?.code || 'FAILED';
  if (code === 'PERMISSION_DENIED') return new CalendarError(PERMISSION_GUIDE, `[${stage}] ${errorDetail(error)}`, code);
  return new CalendarError(`カレンダーの${stage}に失敗しました。`, `[${stage}] ${errorDetail(error)}`, code);
};

/** カレンダー権限を確認し、未許可なら許可ダイアログを出す。許可されれば true */
export const ensureCalendarPermission = async (): Promise<boolean> => {
  const current = await DeviceCalendar.checkPermissions();
  if (current.calendar === 'granted') return true;
  const result = await DeviceCalendar.requestPermissions();
  return result.calendar === 'granted';
};

export const openCalendarAppSettings = () => DeviceCalendar.openAppSettings();

/** 書き込みできるカレンダーの一覧（権限が必要） */
export const listWritableCalendars = async (): Promise<DeviceCalendarInfo[]> => {
  try {
    const { calendars } = await DeviceCalendar.listCalendars();
    return calendars;
  } catch (error) {
    throw toCalendarError(error, '一覧の取得');
  }
};

/** 既定のカレンダー: ログイン中のメールと同じ Google アカウントのメインカレンダー → 主カレンダー → 先頭 */
export const pickDefaultCalendar = (calendars: DeviceCalendarInfo[], email?: string | null): DeviceCalendarInfo | undefined => {
  const lower = (s: string) => (s || '').toLowerCase();
  const isGoogle = (c: DeviceCalendarInfo) => c.accountType === 'com.google';
  if (email) {
    const e = lower(email);
    const own = calendars.filter((c) => isGoogle(c) && lower(c.accountName) === e);
    const main = own.find((c) => c.isPrimary) || own.find((c) => lower(c.displayName) === e) || own[0];
    if (main) return main;
  }
  return calendars.find((c) => isGoogle(c) && c.isPrimary) || calendars.find((c) => c.isPrimary) || calendars[0];
};

/** この端末（インストール）ごとのID。アプリを入れ直すと変わる */
const DEVICE_ID_STORAGE_KEY = 'abc_device_id';
export const getDeviceId = (): string => {
  try {
    let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
};

export const exportRecordKey = (deviceId: string, calendarId: string) => `${deviceId}_${calendarId}`;

/** 登録内容のハッシュ（FNV-1a 32bit）。内容が変わったかの判定だけに使う */
const contentHash = (title: string, date: string, description: string): string => {
  const str = `${title}\u0000${date}\u0000${description}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

export interface ExportOutcome {
  summary: UpsertResult;
  /** エクスポート記録を書き込んだタスク（taskId → 更新後のエクスポート記録一式） */
  recordUpdates: Map<string, Record<string, CalendarExportRecord>>;
  /** v0.5.1 の目印を消した予定の数 */
  cleanedLegacy: number;
}

/**
 * 完了タスクを選択カレンダーへ登録・更新する。予定には目印を入れない。
 * どのタスクをどの予定に書いたかは、タスクの calendarExports（端末ID＋カレンダーIDごと）に保存する。
 * - 記録なし → 新規登録して記録
 * - 記録あり → 予定ID（_id）で予定を探す。内容のハッシュが違えば更新、同じならスキップ
 * - 記録はあるが予定が消えていた（カレンダーで削除） → 新規登録して記録を更新
 * - 他の端末・他のカレンダーの記録しかない → この端末・このカレンダーでは未登録として新規登録
 */
export const exportCompletedTasksToDeviceCalendar = async (tasks: Task[], prefix: string, calendarId: string): Promise<ExportOutcome> => {
  const deviceId = getDeviceId();
  const key = exportRecordKey(deviceId, calendarId);
  const now = new Date().toISOString();
  const recordUpdates = new Map<string, Record<string, CalendarExportRecord>>();

  // 1) v0.5.1 で説明欄に入れた目印を取り除き、その予定を記録に引き継ぐ（重複登録を防ぐ）
  const legacy = new Map<string, string>();
  let cleanedLegacy = 0;
  try {
    const { adopted } = await DeviceCalendar.cleanLegacyMarkers({ calendarId });
    cleanedLegacy = adopted.length;
    adopted.forEach((a) => {
      if (!legacy.has(a.taskId)) legacy.set(a.taskId, a.eventId);
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'PERMISSION_DENIED') throw toCalendarError(error, '書き込み');
    console.warn('古い目印の後片付けに失敗しました（エクスポートは続行）:', error);
  }

  // 2) 登録・更新
  const targets = exportableTasks(tasks);
  const prepared = targets.map((task) => {
    const title = buildEventTitle(task, prefix);
    const description = (task.notes || '').trim();
    const date = eventDateOf(task);
    const hash = contentHash(title, date, description);
    const rec = task.calendarExports?.[key];
    const eventId = rec?.eventId || legacy.get(task.id) || '';
    // 引き継いだ予定は説明欄を書き直したので、必ず更新して内容を揃える
    const changed = !rec || rec.hash !== hash;
    return { task, title, description, date, hash, eventId, changed };
  });

  let results: UpsertItemResult[];
  try {
    ({ results } = await DeviceCalendar.upsertEvents({
      calendarId,
      events: prepared.map((p) => ({
        taskId: p.task.id,
        title: p.title,
        description: p.description,
        date: p.date,
        eventId: p.eventId || undefined,
        changed: p.changed,
      })),
    }));
  } catch (error) {
    throw toCalendarError(error, '書き込み');
  }

  const summary: UpsertResult = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const byTask = new Map(prepared.map((p) => [p.task.id, p]));
  for (const r of results) {
    const p = byTask.get(r.taskId);
    if (r.status === 'failed' || !p || !r.eventId) {
      summary.failed += 1;
      summary.errors.push(`${p?.task.title || r.taskId}: ${r.error || 'unknown'}`);
      continue;
    }
    summary[r.status] += 1;
    const prev = p.task.calendarExports?.[key];
    if (r.status === 'skipped' && prev && prev.eventId === r.eventId) continue; // 記録の書き換え不要
    recordUpdates.set(p.task.id, {
      ...(p.task.calendarExports || {}),
      [key]: { deviceId, calendarId, eventId: r.eventId, exportedAt: now, hash: p.hash },
    });
  }
  return { summary, recordUpdates, cleanedLegacy };
};
