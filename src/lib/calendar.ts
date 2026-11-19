import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PermissionState } from '@capacitor/core';
import { Task } from '../types';
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

interface DeviceCalendarPlugin {
  checkPermissions(): Promise<{ calendar: PermissionState }>;
  requestPermissions(): Promise<{ calendar: PermissionState }>;
  openAppSettings(): Promise<void>;
  listCalendars(): Promise<{ calendars: DeviceCalendarInfo[] }>;
  upsertEvents(options: {
    calendarId: string;
    events: { taskId: string; title: string; description: string; date: string }[];
  }): Promise<UpsertResult>;
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

/** 完了タスクを選択カレンダーへ登録・更新 */
export const exportCompletedTasksToDeviceCalendar = async (tasks: Task[], prefix: string, calendarId: string): Promise<UpsertResult> => {
  const events = exportableTasks(tasks).map((task) => ({
    taskId: task.id,
    title: buildEventTitle(task, prefix),
    description: (task.notes || '').trim(),
    date: eventDateOf(task),
  }));
  try {
    return await DeviceCalendar.upsertEvents({ calendarId, events });
  } catch (error) {
    throw toCalendarError(error, '書き込み');
  }
};
