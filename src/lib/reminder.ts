import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Task } from '../types';
import { getLocalTasks, saveLocalTasks } from './db';
import { getLocalDateString } from './dates';

let schedulerIntervalId: number | null = null;
let listenersAttached = false;
let nativePermissionGranted = false;

const notificationIdFor = (taskId: string): number => {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = ((hash << 5) - hash + taskId.charCodeAt(i)) | 0;
  }
  const id = Math.abs(hash);
  return id === 0 ? 1 : id % 2147483647;
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (Capacitor.isNativePlatform()) {
    try {
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') {
        status = await LocalNotifications.requestPermissions();
      }
      nativePermissionGranted = status.display === 'granted';

      const exact = (LocalNotifications as unknown as {
        checkExactNotificationSetting?: () => Promise<{ exact_alarm: string }>;
        changeExactNotificationSetting?: () => Promise<{ exact_alarm: string }>;
      });
      if (exact.checkExactNotificationSetting && exact.changeExactNotificationSetting) {
        const current = await exact.checkExactNotificationSetting();
        if (current.exact_alarm !== 'granted') {
          await exact.changeExactNotificationSetting();
        }
      }
      return nativePermissionGranted;
    } catch (error) {
      console.error('ネイティブ通知許可の取得に失敗しました:', error);
      return false;
    }
  }

  if (!('Notification' in window)) {
    console.warn('This browser does not support desktop notifications');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return new Promise((resolve) => {
      try {
        Notification.requestPermission((permission) => {
          resolve(permission === 'granted');
        });
      } catch (e) {
        resolve(false);
      }
    });
  }
};

const reminderTitle = (task: Task): string => {
  const prefix = task.priorityLetter ? `[${task.priorityLetter}${task.priorityNumber || ''}] ` : '';
  return `【リマインダー】${prefix}${task.title}`;
};

const shouldRemind = (task: Task): boolean => {
  return (
    !!task.reminderEnabled &&
    !!task.dueDate &&
    !!task.reminderTime &&
    task.status !== 'completed' &&
    task.status !== 'deleted' &&
    !task.reminderNotified
  );
};

const reminderDate = (task: Task): Date | null => {
  const [year, month, day] = task.dueDate.split('-').map((v) => parseInt(v, 10));
  const [hours, minutes] = task.reminderTime.split(':').map((v) => parseInt(v, 10));
  if ([year, month, day, hours, minutes].some((n) => Number.isNaN(n))) {
    return null;
  }
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

export const rescheduleNativeReminders = async (tasks: Task[]): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const pending = await LocalNotifications.getPending();
    const pendingIds = pending.notifications.map((n) => ({ id: n.id }));
    if (pendingIds.length > 0) {
      await LocalNotifications.cancel({ notifications: pendingIds });
    }

    const now = Date.now();
    const notifications = tasks
      .filter(shouldRemind)
      .map((task) => {
        const at = reminderDate(task);
        if (!at || at.getTime() <= now) return null;
        return {
          id: notificationIdFor(task.id),
          title: reminderTitle(task),
          body: task.notes || 'タスクの時間になりました。',
          schedule: {
            at,
            allowWhileIdle: true,
            repeats: false,
          },
          extra: { taskId: task.id },
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null);

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }
  } catch (error) {
    console.error('リマインダーの再スケジュールに失敗しました:', error);
  }
};

const attachNativeListeners = (onTasksUpdated?: (tasks: Task[]) => void) => {
  if (listenersAttached || !Capacitor.isNativePlatform()) return;
  listenersAttached = true;

  void LocalNotifications.addListener('localNotificationReceived', (notification) => {
    const taskId = (notification.extra as { taskId?: string } | undefined)?.taskId;
    if (!taskId) return;
    const tasks = getLocalTasks();
    let changed = false;
    const updated = tasks.map((task) => {
      if (task.id === taskId && !task.reminderNotified) {
        changed = true;
        return { ...task, reminderNotified: true, updatedAt: new Date().toISOString() };
      }
      return task;
    });
    if (changed) {
      saveLocalTasks(updated);
      if (onTasksUpdated) onTasksUpdated(updated);
    }
  });
};

export const startReminderScheduler = (onTasksUpdated?: (tasks: Task[]) => void) => {
  if (schedulerIntervalId) {
    window.clearInterval(schedulerIntervalId);
  }

  if (Capacitor.isNativePlatform()) {
    attachNativeListeners(onTasksUpdated);
    void (async () => {
      const granted = await requestNotificationPermission();
      if (granted) {
        await rescheduleNativeReminders(getLocalTasks());
      }
    })();
    return;
  }

  schedulerIntervalId = window.setInterval(() => {
    checkAndTriggerReminders(onTasksUpdated);
  }, 15000);
};

export const stopReminderScheduler = () => {
  if (schedulerIntervalId) {
    window.clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }
};

const checkAndTriggerReminders = (onTasksUpdated?: (tasks: Task[]) => void) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const tasks = getLocalTasks();
  const todayStr = getLocalDateString();
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${hours}:${minutes}`;

  let hasChanges = false;
  const updatedTasks = tasks.map((task) => {
    if (
      shouldRemind(task) &&
      task.dueDate === todayStr &&
      task.reminderTime === currentTimeStr
    ) {
      new Notification(reminderTitle(task), {
        body: task.notes || 'タスクの時間になりました。',
        icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⏰</text></svg>',
      });
      hasChanges = true;
      return { ...task, reminderNotified: true, updatedAt: new Date().toISOString() };
    }
    return task;
  });

  if (hasChanges) {
    saveLocalTasks(updatedTasks);
    if (onTasksUpdated) {
      onTasksUpdated(updatedTasks);
    }
  }
};
