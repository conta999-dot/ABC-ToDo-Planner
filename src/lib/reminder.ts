import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Task } from '../types';
import { getLocalTasks } from './db';
import { getLocalDateString, addDays } from './dates';

/**
 * 通知（v0.6.3〜、v0.6.5 でタスクごとの通知を復活）
 * - タスクごとの通知: 詳細画面で ON にしたタスクを、実施予定日のその時刻に通知（新規タスクは設定の時刻で ON が初期値）
 *   同じ日・同じ時刻のタスクは 1 つの通知にまとめる。毎日のまとめ通知と同じ時刻のものは、まとめ通知に含める
 * - 設定の ON/OFF がすべての通知の親スイッチ（OFF で全部取り消し）。完了・削除したタスクは通知しない
 * 以下は毎日のまとめ通知の説明
 * - 1日1回、設定した時刻に「今日のタスク・期限切れのタスク」のまとめを通知する（タスクごとの通知はしない）
 * - Android: 端末内の通知（LocalNotifications）。サーバー・FCM は使わない。
 *   正確な時刻のアラーム権限（SCHEDULE_EXACT_ALARM）は求めず、通常の（数分ずれることがある）予約で通知する
 *   内容は予約時点のタスクから作るため、今日から 14 日分を予約し、起動・復帰・タスク変更・設定変更のたびに予約し直す
 * - Web: ページ（タブ）を開いている間だけ、設定時刻を過ぎたら1日1回ブラウザ通知を出す
 */
export const DAILY_NOTIFY_ENABLED_KEY = 'abc_daily_notify_enabled';
export const DAILY_NOTIFY_TIME_KEY = 'abc_daily_notify_time';
const WEB_LAST_NOTIFIED_KEY = 'abc_daily_notify_last_web';
export const DEFAULT_DAILY_NOTIFY_TIME = '08:00';
const DAYS_AHEAD = 14;
const BASE_ID = 7100; // 7100〜7113 を毎日の通知に使う
const SLOT_BASE_ID = 8000; // 8000〜 タスクごとの通知（同じ日時はまとめて1件）
const MAX_SLOTS = 120;

export const isDailyNotifyEnabled = (): boolean => {
  try {
    return localStorage.getItem(DAILY_NOTIFY_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const getDailyNotifyTime = (): string => {
  try {
    const t = localStorage.getItem(DAILY_NOTIFY_TIME_KEY);
    return t && /^\d{2}:\d{2}$/.test(t) ? t : DEFAULT_DAILY_NOTIFY_TIME;
  } catch {
    return DEFAULT_DAILY_NOTIFY_TIME;
  }
};

export const setDailyNotifySettings = (enabled: boolean, time: string) => {
  try {
    localStorage.setItem(DAILY_NOTIFY_ENABLED_KEY, String(enabled));
    if (/^\d{2}:\d{2}$/.test(time)) localStorage.setItem(DAILY_NOTIFY_TIME_KEY, time);
  } catch {
    // ignore
  }
};

const isOpen = (t: Task) => t.status !== 'completed' && t.status !== 'deleted' && !!t.dueDate;

const byPriority = (a: Task, b: Task) => {
  const L = (t: Task) => (t.priorityLetter === 'A' ? 0 : t.priorityLetter === 'B' ? 1 : t.priorityLetter === 'C' ? 2 : 3);
  return L(a) - L(b) || (a.priorityNumber ?? 999) - (b.priorityNumber ?? 999) || (a.dueDate || '').localeCompare(b.dueDate || '');
};

/** その日の通知の内容（今日が実施予定日のタスクと、それより前の未完了タスク）。対象がなければ null */
export const buildDailySummary = (tasks: Task[], dateStr: string): { title: string; body: string } | null => {
  const open = tasks.filter(isOpen);
  const today = open.filter((t) => t.dueDate === dateStr).sort(byPriority);
  const overdue = open.filter((t) => t.dueDate < dateStr).sort(byPriority);
  if (today.length === 0 && overdue.length === 0) return null;
  const label = (t: Task) => `${t.priorityLetter || ''}${t.priorityNumber ?? ''}${t.priorityLetter || t.priorityNumber != null ? ' ' : ''}${t.title}`;
  const title = `今日のタスク ${today.length}件${overdue.length ? `・期限切れ ${overdue.length}件` : ''}`;
  const top = [...today, ...overdue].sort(byPriority).slice(0, 4);
  const lines = top.map((t) => `・${label(t)}${t.dueDate < dateStr ? `（${t.dueDate.slice(5).replace('-', '/')}）` : ''}`);
  const rest = today.length + overdue.length - top.length;
  return { title, body: lines.join('\n') + (rest > 0 ? `\nほか ${rest}件` : '') };
};

const taskLabel = (t: Task) => `${t.priorityLetter || ''}${t.priorityNumber ?? ''}${t.priorityLetter || t.priorityNumber != null ? ' ' : ''}${t.title}`;

/** タスクごとの通知を「日付＋時刻」ごとにまとめる（完了・削除・通知OFF・時刻なしは除く） */
export const buildReminderSlots = (tasks: Task[]): Map<string, Task[]> => {
  const slots = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.reminderEnabled || !t.reminderTime || !/^\d{1,2}:\d{2}$/.test(t.reminderTime) || !t.dueDate) continue;
    if (t.status === 'completed' || t.status === 'deleted') continue;
    const key = `${t.dueDate} ${t.reminderTime.padStart(5, '0')}`;
    slots.set(key, [...(slots.get(key) || []), t]);
  }
  for (const list of slots.values()) list.sort(byPriority);
  return slots;
};

/** 同じ日時のタスクごとの通知の内容 */
export const buildSlotNotification = (list: Task[]): { title: string; body: string } => {
  if (list.length === 1) {
    const t = list[0];
    return { title: `【リマインダー】${taskLabel(t)}`, body: t.notes || 'タスクの時間になりました。' };
  }
  const top = list.slice(0, 5).map((t) => `・${taskLabel(t)}`);
  return { title: `【リマインダー】${list.length}件のタスク`, body: top.join('\n') + (list.length > 5 ? `\nほか ${list.length - 5}件` : '') };
};

/** 通知の許可（Android 13 以降は POST_NOTIFICATIONS の許可ダイアログ。Web はブラウザの許可） */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (Capacitor.isNativePlatform()) {
    try {
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') status = await LocalNotifications.requestPermissions();
      return status.display === 'granted';
    } catch (error) {
      console.error('通知の許可の取得に失敗しました:', error);
      return false;
    }
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
};

export const checkNotificationPermission = async (): Promise<boolean> => {
  if (Capacitor.isNativePlatform()) {
    try {
      return (await LocalNotifications.checkPermissions()).display === 'granted';
    } catch {
      return false;
    }
  }
  return 'Notification' in window && Notification.permission === 'granted';
};

const cancelAllPending = async () => {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
};

let rescheduleTimer: number | null = null;

/** Android: 毎日の通知を予約し直す（オフなら全部取り消す）。連続した呼び出しは 0.8 秒まとめる */
export const rescheduleNativeReminders = (tasks?: Task[]): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (rescheduleTimer) window.clearTimeout(rescheduleTimer);
  return new Promise((resolve) => {
    rescheduleTimer = window.setTimeout(() => {
      rescheduleTimer = null;
      void scheduleDailyNow(tasks ?? getLocalTasks()).finally(resolve);
    }, 800);
  });
};

/** 予約した件数を返す（テスト・表示用） */
export const scheduleDailyNow = async (tasks: Task[]): Promise<number> => {
  if (!Capacitor.isNativePlatform()) return 0;
  try {
    // 以前の版のタスクごとの通知も含めて、予約済みをすべて取り消す
    await cancelAllPending();
    if (!isDailyNotifyEnabled()) return 0;
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return 0;
    const [hh, mm] = getDailyNotifyTime().split(':').map((v) => parseInt(v, 10));
    const now = Date.now();
    const today = getLocalDateString();
    const notifications = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dateStr = addDays(today, i);
      const [y, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
      const at = new Date(y, m - 1, d, hh, mm, 0, 0);
      if (at.getTime() <= now) continue;
      const summary = buildDailySummary(tasks, dateStr);
      if (!summary) continue;
      notifications.push({
        id: BASE_ID + i,
        title: summary.title,
        body: summary.body,
        largeBody: summary.body,
        schedule: { at, allowWhileIdle: true },
        // 正確な時刻のアラーム権限は使わない（特別な許可が要らない通常の予約）
        isExactNotification: false,
        extra: { kind: 'daily', date: dateStr },
      });
    }
    // タスクごとの通知（同じ日時はまとめて1件。まとめ通知と同じ日時のものはまとめ通知に含めるので出さない）
    const dailyKeys = new Set(notifications.map((n) => `${n.extra.date} ${getDailyNotifyTime()}`));
    const limit = new Date(today.replace(/-/g, '/') + ' 00:00').getTime() + DAYS_AHEAD * 86400000;
    let slotIndex = 0;
    const slots = [...buildReminderSlots(tasks).entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, list] of slots) {
      if (slotIndex >= MAX_SLOTS) break;
      const [date, time] = key.split(' ');
      const [y, m, d] = date.split('-').map((v) => parseInt(v, 10));
      const [h, mi] = time.split(':').map((v) => parseInt(v, 10));
      const at = new Date(y, m - 1, d, h, mi, 0, 0);
      if (at.getTime() <= now || at.getTime() >= limit) continue;
      if (dailyKeys.has(key)) continue;
      const n = buildSlotNotification(list);
      notifications.push({
        id: SLOT_BASE_ID + slotIndex++,
        title: n.title,
        body: n.body,
        largeBody: n.body,
        schedule: { at, allowWhileIdle: true },
        isExactNotification: false,
        extra: { kind: 'tasks', date, taskIds: list.map((t) => t.id).join(',') },
      } as (typeof notifications)[number]);
    }
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications } as Parameters<typeof LocalNotifications.schedule>[0]);
    }
    return notifications.length;
  } catch (error) {
    console.error('毎日の通知の予約に失敗しました:', error);
    return 0;
  }
};

// ---- Web（タブを開いている間だけ）
let schedulerIntervalId: number | null = null;

const WEB_SLOTS_KEY = 'abc_task_notify_fired_web';

/** Web: 今日のタスクごとの通知（時刻を過ぎて未通知の日時を1回だけ。まとめ通知と同じ時刻はまとめ通知に含める） */
const checkWebTaskSlots = () => {
  if (!isDailyNotifyEnabled() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = getLocalDateString();
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let fired: string[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(WEB_SLOTS_KEY) || '[]');
    fired = Array.isArray(raw) ? raw.filter((k: string) => k.startsWith(today)) : [];
  } catch {
    fired = [];
  }
  for (const [key, list] of buildReminderSlots(getLocalTasks())) {
    const [date, time] = key.split(' ');
    if (date !== today || time > hhmm || fired.includes(key)) continue;
    fired.push(key);
    // ページを開いたのが時刻より大きく後なら、古い通知は出さない（30分以内だけ）
    const [h, mi] = time.split(':').map((v) => parseInt(v, 10));
    if (now.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi).getTime() > 30 * 60000) continue;
    if (time === getDailyNotifyTime()) continue;
    const n = buildSlotNotification(list);
    try {
      new Notification(n.title, { body: n.body, icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: `abc-task-${key}` });
    } catch (e) {
      console.warn('ブラウザ通知を表示できませんでした:', e);
    }
  }
  try {
    localStorage.setItem(WEB_SLOTS_KEY, JSON.stringify(fired));
  } catch {
    // ignore
  }
};

const checkWebDaily = () => {
  checkWebTaskSlots();
  if (!isDailyNotifyEnabled() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = getLocalDateString();
  try {
    if (localStorage.getItem(WEB_LAST_NOTIFIED_KEY) === today) return;
  } catch {
    return;
  }
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm < getDailyNotifyTime()) return;
  localStorage.setItem(WEB_LAST_NOTIFIED_KEY, today);
  const summary = buildDailySummary(getLocalTasks(), today);
  if (!summary) return;
  try {
    new Notification(summary.title, { body: summary.body, icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: `abc-daily-${today}` });
  } catch (e) {
    console.warn('ブラウザ通知を表示できませんでした:', e);
  }
};

export const startReminderScheduler = (_onTasksUpdated?: (tasks: Task[]) => void) => {
  stopReminderScheduler();
  if (Capacitor.isNativePlatform()) {
    // 起動時に予約し直す。オンのときは、まだ聞いていなければ通知の許可を聞く（Android 13 以降。断られた後は出ない）
    void (async () => {
      if (isDailyNotifyEnabled()) await requestNotificationPermission();
      await scheduleDailyNow(getLocalTasks());
    })();
    return;
  }
  checkWebDaily();
  schedulerIntervalId = window.setInterval(checkWebDaily, 30000);
};

export const stopReminderScheduler = () => {
  if (schedulerIntervalId) {
    window.clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }
};
