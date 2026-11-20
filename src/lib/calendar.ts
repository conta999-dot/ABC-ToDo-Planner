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
  /** 端末でこのカレンダーの同期がオンか（オフだと Google に上がらない） */
  syncEvents?: boolean;
  accessLevel?: number;
}

/** 書き込み後に読み戻した予定 */
export interface InsertedEventCheck {
  eventId: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  deleted: boolean;
}

export interface CalendarTargetInfo {
  id?: string;
  displayName?: string;
  accountName?: string;
  accountType?: string;
  visible?: boolean;
  syncEvents?: boolean;
}

/** カレンダー内で見つかった、このアプリが登録したと思われる予定 */
export interface AppEventInfo {
  eventId: string;
  title: string;
  date: string;
  allDay: boolean;
  calendarId: string;
  calendarName: string;
  accountName: string;
  dirty: boolean;
  synced: boolean;
}

/** 直近のエクスポートの記録（端末に保存して設定画面に表示） */
export interface ExportHistoryEntry {
  at: string;
  calendar: CalendarTargetInfo;
  created: number;
  failed: number;
  items: { title: string; date: string; ok: boolean; note?: string }[];
}

export const EXPORT_HISTORY_STORAGE_KEY = 'abc_calendar_export_history';

export const loadExportHistory = (): ExportHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(EXPORT_HISTORY_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as ExportHistoryEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const saveExportHistory = (entry: ExportHistoryEntry) => {
  try {
    const list = [entry, ...loadExportHistory()].slice(0, 5);
    localStorage.setItem(EXPORT_HISTORY_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
};

export interface ExportResult {
  created: number;
  failed: number;
  errors: string[];
}

interface InsertItemResult {
  taskId: string;
  status: 'created' | 'failed';
  error?: string;
  eventId?: string;
  check?: InsertedEventCheck;
}

interface DeviceCalendarPlugin {
  checkPermissions(): Promise<{ calendar: PermissionState }>;
  requestPermissions(): Promise<{ calendar: PermissionState }>;
  openAppSettings(): Promise<void>;
  listCalendars(): Promise<{ calendars: DeviceCalendarInfo[] }>;
  insertEvents(options: {
    calendarId: string;
    events: { taskId: string; title: string; description: string; date: string }[];
  }): Promise<{ results: InsertItemResult[]; calendar?: CalendarTargetInfo }>;
  findAppEvents(options: { prefix: string; calendarId?: string }): Promise<{ events: AppEventInfo[] }>;
  deleteEvents(options: { eventIds: string[] }): Promise<{ deleted: number; errors: string[] }>;
  cleanLegacyMarkers(options: { calendarId: string }): Promise<{ adopted: { taskId: string; eventId: string }[] }>;
  refreshCalendars(): Promise<{ accounts: { accountName: string; accountType: string }[] }>;
  enableCalendarSync(options: { calendarId: string }): Promise<{ updated: number }>;
}

const DeviceCalendar = registerPlugin<DeviceCalendarPlugin>('DeviceCalendar');

export const isCalendarExportAvailable = () => Capacitor.getPlatform() === 'android';

export const CALENDAR_PREFIX_STORAGE_KEY = 'abc_calendar_prefix';
export const CALENDAR_ID_STORAGE_KEY = 'abc_calendar_id';
export const DEFAULT_CALENDAR_PREFIX = '［ToDo］';
/** 以前の既定値（保存値がこれなら新しい既定値に置き換える。利用者が変えた値はそのまま） */
export const LEGACY_DEFAULT_PREFIXES = ['[ABC]', '[ToDo]'];
/** 予定を探すときは、以前の既定値で登録した予定も対象にする */
export const loadCalendarPrefix = (): string => {
  try {
    const saved = localStorage.getItem(CALENDAR_PREFIX_STORAGE_KEY);
    if (saved === null || LEGACY_DEFAULT_PREFIXES.includes(saved)) {
      localStorage.setItem(CALENDAR_PREFIX_STORAGE_KEY, DEFAULT_CALENDAR_PREFIX);
      return DEFAULT_CALENDAR_PREFIX;
    }
    return saved;
  } catch {
    return DEFAULT_CALENDAR_PREFIX;
  }
};

/** Google カレンダーの「新しいカレンダーを作成」画面 */
export const GOOGLE_CREATE_CALENDAR_URL = 'https://calendar.google.com/calendar/r/settings/createcalendar';

export type CalendarGroupKind = 'google' | 'local' | 'other';
export interface CalendarGroup {
  key: string;
  kind: CalendarGroupKind;
  label: string;
  accountName: string;
  accountType: string;
  calendars: DeviceCalendarInfo[];
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  'com.google': 'Google',
  LOCAL: '端末内（ローカル・同期なし）',
  'com.samsung.android.calendar': 'Samsung',
  'com.osp.app.signin': 'Samsung',
  'com.android.exchange': 'Exchange',
  'com.google.android.gm.exchange': 'Exchange（Gmail）',
  'com.microsoft.office.outlook.USER_ACCOUNT': 'Outlook',
};

export const calendarKind = (c: Pick<DeviceCalendarInfo, 'accountType'>): CalendarGroupKind =>
  c.accountType === 'com.google' ? 'google' : c.accountType === 'LOCAL' ? 'local' : 'other';

export const accountTypeLabel = (type: string): string => ACCOUNT_TYPE_LABELS[type] || type || '不明';

/** カレンダーをアカウントごとにまとめる（Google → 端末内 → その他） */
export const groupCalendars = (calendars: DeviceCalendarInfo[], email?: string | null): CalendarGroup[] => {
  const map = new Map<string, CalendarGroup>();
  for (const c of calendars) {
    const kind = calendarKind(c);
    const key = `${c.accountType}\n${c.accountName}`;
    let g = map.get(key);
    if (!g) {
      const typeLabel = accountTypeLabel(c.accountType);
      const label = kind === 'local' ? typeLabel : `${typeLabel}（${c.accountName}）`;
      g = { key, kind, label, accountName: c.accountName, accountType: c.accountType, calendars: [] };
      map.set(key, g);
    }
    g.calendars.push(c);
  }
  const order: Record<CalendarGroupKind, number> = { google: 0, local: 1, other: 2 };
  const own = (email || '').toLowerCase();
  return [...map.values()]
    .map((g) => ({ ...g, calendars: [...g.calendars].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.displayName.localeCompare(b.displayName, 'ja')) }))
    .sort((a, b) =>
      order[a.kind] - order[b.kind] ||
      Number(b.accountName.toLowerCase() === own) - Number(a.accountName.toLowerCase() === own) ||
      a.label.localeCompare(b.label, 'ja'));
};

export const calendarGroupKey = (c: Pick<DeviceCalendarInfo, 'accountType' | 'accountName'>) => `${c.accountType}\n${c.accountName}`;

const normName = (s: string) => (s || '').normalize('NFKC').trim().toLowerCase();

/** 入力したカレンダー名に一致するカレンダー（選んだアカウントを優先、表記ゆれは全角半角・大小文字を無視） */
export const findCalendarByName = (calendars: DeviceCalendarInfo[], name: string, preferGroupKey?: string): DeviceCalendarInfo | undefined => {
  const n = normName(name);
  if (!n) return undefined;
  const hits = calendars.filter((c) => normName(c.displayName) === n);
  return hits.find((c) => preferGroupKey && calendarGroupKey(c) === preferGroupKey) || hits.find((c) => calendarKind(c) === 'google') || hits[0];
};

/** 端末のカレンダーアカウントに同期を依頼（Google で作ったカレンダーを端末に取り込む） */
export const refreshDeviceCalendars = async (): Promise<number> => {
  try {
    const { accounts } = await DeviceCalendar.refreshCalendars();
    return accounts.length;
  } catch (error) {
    throw toCalendarError(error, '同期の依頼');
  }
};

/** 選んだカレンダーの同期と表示をオンにする */
export const enableCalendarSync = async (calendarId: string): Promise<void> => {
  try {
    await DeviceCalendar.enableCalendarSync({ calendarId });
  } catch (error) {
    throw toCalendarError(error, '同期の設定');
  }
};

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

/** エクスポート対象: 完了していて、まだエクスポート済みフラグが立っていないタスク */
export const exportableTasks = (tasks: Task[]): Task[] =>
  tasks.filter((t) =>
    t.status === 'completed' &&
    !t.calendarExported &&
    /^\d{4}-\d{2}-\d{2}$/.test(eventDateOf(t)) &&
    !!(t.title || '').trim());

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
  const usable = calendars.filter((c) => c.visible !== false && c.syncEvents !== false);
  if (usable.length > 0) calendars = usable;
  const isGoogle = (c: DeviceCalendarInfo) => c.accountType === 'com.google';
  if (email) {
    const e = lower(email);
    const own = calendars.filter((c) => isGoogle(c) && lower(c.accountName) === e);
    const main = own.find((c) => c.isPrimary) || own.find((c) => lower(c.displayName) === e) || own[0];
    if (main) return main;
  }
  return calendars.find((c) => isGoogle(c) && c.isPrimary) || calendars.find((c) => c.isPrimary) || calendars[0];
};

export interface ExportOutcome {
  summary: ExportResult;
  /** エクスポート済みフラグを立てるタスクID（登録に成功したもの＋旧版の予定を引き継いだもの） */
  exportedTaskIds: string[];
  /** v0.5.1 の目印を消した予定の数 */
  cleanedLegacy: number;
  /** 書き込み先のカレンダー */
  calendar?: CalendarTargetInfo;
  /** 書き込んだ予定の読み戻し結果（日付の確認用） */
  history?: ExportHistoryEntry;
}

/**
 * 完了していて未エクスポートのタスクだけを、選択カレンダーへ終日予定として新規登録する。
 * 登録に成功したタスクにはアプリ側でエクスポート済みフラグを立て、以後はカレンダーに一切触らない
 * （タスクを編集・削除しても、予定の更新・削除・検索はしない）。
 */
export const exportCompletedTasksToDeviceCalendar = async (tasks: Task[], prefix: string, calendarId: string): Promise<ExportOutcome> => {
  // 1) 旧版（v0.5.1）が説明欄に入れた目印「abc-task:<ID>」の後片付け。
  //    目印を消した予定のタスクは登録済みとしてフラグを立てる（二重登録しない）
  const adopted = new Set<string>();
  let cleanedLegacy = 0;
  try {
    const res = await DeviceCalendar.cleanLegacyMarkers({ calendarId });
    cleanedLegacy = res.adopted.length;
    res.adopted.forEach((a) => adopted.add(a.taskId));
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'PERMISSION_DENIED') throw toCalendarError(error, '書き込み');
    console.warn('古い目印の後片付けに失敗しました（エクスポートは続行）:', error);
  }

  // 2) 未エクスポートの完了タスクを新規登録
  const targets = exportableTasks(tasks).filter((t) => !adopted.has(t.id));
  const summary: ExportResult = { created: 0, failed: 0, errors: [] };
  const exportedTaskIds = tasks.filter((t) => adopted.has(t.id) && !t.calendarExported).map((t) => t.id);
  if (targets.length > 0) {
    let results: InsertItemResult[];
    let calendar: CalendarTargetInfo | undefined;
    try {
      ({ results, calendar } = await DeviceCalendar.insertEvents({
        calendarId,
        events: targets.map((task) => ({
          taskId: task.id,
          title: buildEventTitle(task, prefix),
          description: (task.notes || '').trim(),
          date: eventDateOf(task),
        })),
      }));
    } catch (error) {
      throw toCalendarError(error, '書き込み');
    }
    const byId = new Map(targets.map((t) => [t.id, t]));
    const items: ExportHistoryEntry['items'] = [];
    for (const r of results) {
      const task = byId.get(r.taskId);
      const expected = task ? eventDateOf(task) : '';
      const title = task ? buildEventTitle(task, prefix) : r.taskId;
      if (r.status === 'created') {
        const c = r.check;
        // 読み戻した予定が、終日・UTC・正しい日付になっているか確認
        const ok = !!c && c.allDay && c.timezone === 'UTC' && c.start === expected && !c.deleted && c.calendarId === calendarId;
        summary.created += 1;
        exportedTaskIds.push(r.taskId);
        items.push({ title, date: c?.start || expected, ok, note: ok ? undefined : `確認できない項目あり: ${JSON.stringify(c || {})}` });
      } else {
        summary.failed += 1;
        summary.errors.push(`${task?.title || r.taskId}: ${r.error || 'unknown'}`);
        items.push({ title, date: expected, ok: false, note: r.error || 'unknown' });
      }
    }
    const history: ExportHistoryEntry = {
      at: new Date().toISOString(),
      calendar: calendar || { id: calendarId },
      created: summary.created,
      failed: summary.failed,
      items,
    };
    saveExportHistory(history);
    return { summary, exportedTaskIds, cleanedLegacy, calendar, history };
  }
  return { summary, exportedTaskIds, cleanedLegacy };
};

/** このアプリの形式（プレフィックスで始まる終日予定）の予定を探す。読むだけ。calendarId を省くと全カレンダー */
export const findAppEvents = async (prefix: string, calendarId?: string): Promise<AppEventInfo[]> => {
  const prefixes = [...new Set([prefix, ...LEGACY_DEFAULT_PREFIXES].filter((p) => p.trim()))];
  if (prefixes.length === 0) return [];
  try {
    const seen = new Set<string>();
    const out: AppEventInfo[] = [];
    for (const p of prefixes) {
      const { events } = await DeviceCalendar.findAppEvents({ prefix: p, calendarId });
      for (const e of events) {
        if (!e.allDay || seen.has(String(e.eventId))) continue;
        seen.add(String(e.eventId));
        out.push(e);
      }
    }
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  } catch (error) {
    throw toCalendarError(error, '予定の検索');
  }
};

/** 利用者が確認した予定だけを削除する */
export const deleteAppEvents = async (eventIds: string[]): Promise<{ deleted: number; errors: string[] }> => {
  try {
    return await DeviceCalendar.deleteEvents({ eventIds });
  } catch (error) {
    throw toCalendarError(error, '予定の削除');
  }
};
