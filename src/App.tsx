import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Plus,
  Moon,
  Sun,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
  HelpCircle,
  Sparkles,
  Inbox,
  X,
  Cloud,
  CloudOff,
  AlertTriangle,
  RefreshCw,
  CalendarPlus,
  UserRound,
  LogOut,
  LogIn,
} from 'lucide-react';

import { User } from 'firebase/auth';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { App as CapApp } from '@capacitor/app';

import { Task, PriorityLetter, TaskQuadrant, TaskStatus, getTaskQuadrant, getStatusSymbol } from './types';
import { getLocalTasks, saveLocalTasks } from './lib/db';
import { startReminderScheduler, stopReminderScheduler, requestNotificationPermission, rescheduleNativeReminders } from './lib/reminder';
import { getLocalDateString, addDays, newTaskId, parseLocalDate } from './lib/dates';
import { initAuth, googleSignIn, logout as firebaseLogout } from './lib/firebase';
import {
  buildEventTitle,
  exportableTasks,
  exportCompletedTasksToDeviceCalendar,
  ensureCalendarPermission,
  listWritableCalendars,
  pickDefaultCalendar,
  openCalendarAppSettings,
  isCalendarExportAvailable,
  CalendarError,
  DeviceCalendarInfo,
  PERMISSION_GUIDE,
  CALENDAR_PREFIX_STORAGE_KEY,
  CALENDAR_ID_STORAGE_KEY,
  DEFAULT_CALENDAR_PREFIX,
} from './lib/calendar';
import { errorDetail } from './lib/nativeGoogleAuth';
import { subscribeToUserTasks, pushUserTasks } from './lib/sync';
import { mergeTasks } from './lib/drive';

// Supporting Components (Inlined or imported cleanly)
import BackupButton from './components/BackupButton';
import TaskForm from './components/TaskForm';

// Helper to format YYYY-MM-DD to MM/DD
const formatDueDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}`;
  }
  return dateStr;
};

// Automatically extract due date from text and return a clean title with extracted date
const parseDueDateFromText = (text: string): { dueDate: string | null; cleanedText: string } => {
  let cleanedText = text;
  let dueDate: string | null = null;
  const today = new Date();

  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const toHalfWidth = (str: string): string => {
    return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });
  };
  const normalized = toHalfWidth(text);

  // 1. 特殊キーワード
  if (normalized.includes('今日') || normalized.includes('本日')) {
    dueDate = formatDate(today);
    cleanedText = cleanedText.replace(/今日|本日/g, '').trim();
  } else if (normalized.includes('明日')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    dueDate = formatDate(tomorrow);
    cleanedText = cleanedText.replace(/明日/g, '').trim();
  } else if (normalized.includes('明後日')) {
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);
    dueDate = formatDate(dayAfter);
    cleanedText = cleanedText.replace(/明後日/g, '').trim();
  } else if (normalized.includes('来週')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    dueDate = formatDate(nextWeek);
    cleanedText = cleanedText.replace(/来週/g, '').trim();
  }

  // 2. YYYY/MM/DD または YYYY-MM-DD 形式
  if (!dueDate) {
    const matchFullDate = normalized.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (matchFullDate) {
      const year = parseInt(matchFullDate[1], 10);
      const month = parseInt(matchFullDate[2], 10) - 1;
      const day = parseInt(matchFullDate[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) {
        dueDate = formatDate(d);
        const originalMatch = text.match(new RegExp(matchFullDate[0].replace(/[-\/]/g, '[\\/\\-]')));
        if (originalMatch) {
          cleanedText = cleanedText.replace(originalMatch[0], '').trim();
        } else {
          cleanedText = cleanedText.replace(matchFullDate[0], '').trim();
        }
      }
    }
  }

  // 3. MM/DD または MM-DD 形式
  if (!dueDate) {
    const matchShortDate = normalized.match(/(\d{1,2})[\/\-](\d{1,2})/);
    if (matchShortDate) {
      const month = parseInt(matchShortDate[1], 10) - 1;
      const day = parseInt(matchShortDate[2], 10);
      const d = new Date(today.getFullYear(), month, day);
      if (!isNaN(d.getTime())) {
        dueDate = formatDate(d);
        const originalMatch = text.match(new RegExp(matchShortDate[0].replace(/[-\/]/g, '[\\/\\-]')));
        if (originalMatch) {
          cleanedText = cleanedText.replace(originalMatch[0], '').trim();
        } else {
          cleanedText = cleanedText.replace(matchShortDate[0], '').trim();
        }
      }
    }
  }

  // 4. M月D日 形式
  if (!dueDate) {
    const matchJapaneseDate = normalized.match(/(\d{1,2})月(\d{1,2})日/);
    if (matchJapaneseDate) {
      const month = parseInt(matchJapaneseDate[1], 10) - 1;
      const day = parseInt(matchJapaneseDate[2], 10);
      const d = new Date(today.getFullYear(), month, day);
      if (!isNaN(d.getTime())) {
        dueDate = formatDate(d);
        const monthStr = matchJapaneseDate[1];
        const dayStr = matchJapaneseDate[2];
        const pattern = new RegExp(`[${monthStr}０-９\\d]+月[${dayStr}０-９\\d]+日`);
        cleanedText = cleanedText.replace(pattern, '').trim();
      }
    }
  }

  return { dueDate, cleanedText };
};

const checkAndCreateNextDayCopy = (
  baseTask: Omit<Task, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & Partial<Pick<Task, 'id' | 'userId' | 'copiedFromId'>>,
  nextStatus: TaskStatus,
  existingTasks: Task[],
  sourceId: string,
  userId: string,
): Task | null => {
  if (nextStatus !== 'in_progress' && nextStatus !== 'postponed' && nextStatus !== 'delegated') {
    return null;
  }

  let copyStatus: TaskStatus = 'pending';
  if (nextStatus === 'in_progress') {
    copyStatus = 'in_progress';
  } else if (nextStatus === 'delegated') {
    copyStatus = 'delegated';
  } else if (nextStatus === 'postponed') {
    copyStatus = 'pending'; // 先送りは未選択 (pending)
  }

  const nextDueDate = addDays(getLocalDateString(), 1);
  const alreadyExists = existingTasks.some((task) => {
    if (task.status === 'deleted') return false;
    if (task.dueDate !== nextDueDate) return false;
    if (task.copiedFromId && task.copiedFromId === sourceId) return true;
    if (task.title === baseTask.title) return true;
    return false;
  });
  if (alreadyExists) {
    return null;
  }

  return {
    ...baseTask,
    id: newTaskId(),
    userId,
    dueDate: nextDueDate,
    status: copyStatus,
    completed: false,
    completedAt: null,
    completedDate: '',
    reminderNotified: false,
    copiedFromId: sourceId,
    // エクスポート済みフラグはコピーに引き継がない（コピーは別タスクとして完了時にエクスポート）
    calendarExported: undefined,
    calendarExportedAt: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};


/** 「2026/11/19 17:45:12」→「11/19 17:45」 */
const shortSyncTime = (value: string | null): string => {
  if (!value) return '';
  const m = value.match(/(\d{1,4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  return m ? `${m[2]}/${m[3]} ${m[4]}:${m[5]}` : value;
};

/** 先頭の重要度・緊急度トークン（例: "A3 ", "B ", "5 "）を解析する */
const parsePriorityPrefix = (text: string): { letter: PriorityLetter; number: number | null; rest: string; matched: boolean; letterOnly: boolean } => {
  const original = text.trim();
  const normalized = original.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const cut = (len: number) => original.substring(len).replace(/^[\s　]+/, '');
  const both = normalized.match(/^([A-Ca-c])([0-9]{1,2})/);
  if (both) {
    const num = parseInt(both[2], 10);
    if (num >= 1 && num <= 20) {
      return { letter: both[1].toUpperCase() as PriorityLetter, number: num, rest: cut(1 + both[2].length), matched: true, letterOnly: false };
    }
  }
  const letter = normalized.match(/^([A-Ca-c])(?:[\s　]+|$)/);
  if (letter) {
    return { letter: letter[1].toUpperCase() as PriorityLetter, number: null, rest: cut(1), matched: true, letterOnly: true };
  }
  const num = normalized.match(/^([0-9]{1,2})/);
  if (num) {
    const n = parseInt(num[1], 10);
    if (n >= 1 && n <= 20) {
      return { letter: '', number: n, rest: cut(num[1].length), matched: true, letterOnly: false };
    }
  }
  return { letter: '', number: null, rest: original, matched: false, letterOnly: false };
};

function HeaderStatus({
  user,
  isOnline,
  lastSyncTime,
  syncError,
  isSyncing,
  isSigningIn,
  onSignIn,
  onOpenSettings,
  onShowError,
}: {
  user: User | null;
  isOnline: boolean;
  lastSyncTime: string | null;
  syncError: string | null;
  isSyncing: boolean;
  isSigningIn: boolean;
  onSignIn: () => void;
  onOpenSettings: () => void;
  onShowError: () => void;
}) {
  if (!user) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        disabled={isSigningIn}
        className="h-9 w-9 flex items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 hover:opacity-90 disabled:opacity-60 shrink-0"
        title="Googleでログイン"
        aria-label="Googleでログイン"
        id="btn-header-signin"
      >
        {isSigningIn ? <RefreshCw className="w-[1.125rem] h-[1.125rem] animate-spin" /> : <LogIn className="w-[1.125rem] h-[1.125rem]" />}
      </button>
    );
  }
  const hasError = !!syncError && !isSyncing && isOnline;
  const Icon = !isOnline ? CloudOff : isSyncing ? RefreshCw : hasError ? AlertTriangle : Cloud;
  const tone = !isOnline || hasError
    ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-800/50'
    : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-800/50';
  const label = !isOnline ? 'オフライン' : isSyncing ? '同期中' : hasError ? '同期エラー' : lastSyncTime ? '同期済み' : 'クラウド同期';
  return (
    <button
      type="button"
      onClick={hasError ? onShowError : onOpenSettings}
      className={`h-9 w-9 flex items-center justify-center rounded-xl border shrink-0 ${tone}`}
      title={label}
      aria-label={label}
      id="btn-header-sync-status"
    >
      <Icon className={`w-[1.125rem] h-[1.125rem] ${isSyncing ? 'animate-spin' : ''}`} />
    </button>
  );
}

export default function App() {
  // --- States ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentView, setCurrentView] = useState<'list' | 'matrix' | 'detail' | 'daily' | 'settings'>('list');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [prevView, setPrevView] = useState<'list' | 'matrix' | 'detail' | 'daily' | 'settings'>('list');
  
  // Quick registration inputs
  const [quickTitle, setQuickTitle] = useState('');
  const [quickLetter, setQuickLetter] = useState<PriorityLetter>('');
  const [quickNumber, setQuickNumber] = useState<number | null>(null);

  // Filters
  const [selectedQuadrant, setSelectedQuadrant] = useState<TaskQuadrant | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all_active'); // all_active, pending, completed, etc.

  // UI preferences
  const [darkMode, setDarkMode] = useState(false);
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [quadrantPopup, setQuadrantPopup] = useState<{ id: TaskQuadrant; label: string; desc: string; sub: string } | null>(null);

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncError, setSyncErrorText] = useState<string | null>(null);
  const [syncErrorDetail, setSyncErrorDetail] = useState<string>('');
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string; detail: string } | null>(null);
  /** 同期エラーを設定（第2引数に元のエラーを渡すと、詳細表示用の生情報も保存） */
  const setSyncError = (message: string | null, rawError?: unknown) => {
    setSyncErrorText(message);
    if (message === null) {
      setSyncErrorDetail('');
    } else if (rawError !== undefined) {
      const detail = (rawError as { detail?: string } | null)?.detail || errorDetail(rawError);
      setSyncErrorDetail(detail);
    }
  };
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  // Googleカレンダーへのエクスポート
  const [calendarPrefix, setCalendarPrefix] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(CALENDAR_PREFIX_STORAGE_KEY);
      return saved === null ? DEFAULT_CALENDAR_PREFIX : saved;
    } catch {
      return DEFAULT_CALENDAR_PREFIX;
    }
  });
  const [isExporting, setIsExporting] = useState(false);
  const [deviceCalendars, setDeviceCalendars] = useState<DeviceCalendarInfo[] | null>(null);
  const [calendarPermission, setCalendarPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>(() => {
    try {
      return localStorage.getItem(CALENDAR_ID_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [exportSummary, setExportSummary] = useState<string | null>(null);
  // ビルドバージョン（Android はアプリ情報、Web はビルド時に埋め込んだ値）
  const [appVersionLabel, setAppVersionLabel] = useState<string>(`${__APP_VERSION__}（Web ビルド ${__BUILD_COMMIT__}・${__BUILD_TIME__}）`);
  const authUserRef = useRef<User | null>(null);
  const applyingRemoteRef = useRef(false);

  // Inline editing states for task list
  const [inlineEditingTaskId, setInlineEditingTaskId] = useState<string | null>(null);
  const [inlineEditingField, setInlineEditingField] = useState<'status' | 'priority' | 'title' | null>(null);
  const [inlineEditingTitleValue, setInlineEditingTitleValue] = useState<string>('');

  // Swipe navigation states
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const diffX = e.changedTouches[0].clientX - touchStartX.current;
    const diffY = e.changedTouches[0].clientY - touchStartY.current;

    // Verify it is a distinct horizontal swipe
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
      if (currentView === 'settings' || currentView === 'detail') return;

      const tabs: ('list' | 'matrix' | 'daily')[] = ['daily', 'matrix', 'list'];
      const currentIndex = tabs.indexOf(currentView as any);

      if (currentIndex !== -1) {
        if (diffX > 0) {
          // Swipe Right -> Go to previous tab
          if (currentIndex > 0) {
            setPrevView(currentView);
            setCurrentView(tabs[currentIndex - 1]);
          }
        } else {
          // Swipe Left -> Go to next tab
          if (currentIndex < tabs.length - 1) {
            setPrevView(currentView);
            setCurrentView(tabs[currentIndex + 1]);
          }
        }
      }
    }

    touchStartX.current = null;
    touchStartY.current = null;
  };

  // Long press refs for task rows to transition to detail/edit view
  const longPressTimeoutRef = useRef<any>(null);
  const longPressActiveRef = useRef<boolean>(false);

  const startLongPress = (taskId: string) => {
    longPressActiveRef.current = false;
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
    }
    longPressTimeoutRef.current = setTimeout(() => {
      longPressActiveRef.current = true;
      handleSelectTaskForDetail(taskId);
    }, 600); // 600ms threshold for long press
  };

  const cancelLongPress = () => {
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_PREFIX_STORAGE_KEY, calendarPrefix);
    } catch {
      // ignore
    }
  }, [calendarPrefix]);

  useEffect(() => {
    try {
      if (selectedCalendarId) localStorage.setItem(CALENDAR_ID_STORAGE_KEY, selectedCalendarId);
    } catch {
      // ignore
    }
  }, [selectedCalendarId]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void CapApp.getInfo()
      .then((info) => setAppVersionLabel(`${info.version}（ビルド ${info.build}・Android）`))
      .catch(() => undefined);
  }, []);

  // ステータスバーのアイコン色をアプリのテーマに合わせる（Android）
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void SystemBars.setStyle({ style: darkMode ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
  }, [darkMode]);

  // --- Initialize ---
  useEffect(() => {
    // 1. Local Date Setting
    const localToday = getLocalDateString();
    setSelectedDate(localToday);

    // 2. Load Tasks
    const loaded = getLocalTasks();
    setTasks(loaded);

    // 3. Dark Mode Setup
    const isDark = localStorage.getItem('theme') === 'dark' || 
      (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // 4. Notification permissions check
    if ('Notification' in window) {
      setNotificationsGranted(Notification.permission === 'granted');
    }

    // 5. Start Reminders Scheduler
    startReminderScheduler((updated) => {
      setTasks(updated);
    });

    return () => {
      stopReminderScheduler();
    };
  }, []);

  useEffect(() => {
    const unsub = initAuth(
      (user) => {
        authUserRef.current = user;
        setAuthUser(user);
      },
      () => {
        authUserRef.current = null;
        setAuthUser(null);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const applyStatus = (connected: boolean) => {
      if (!cancelled) setIsOnline(connected);
    };

    applyStatus(typeof navigator === 'undefined' ? true : navigator.onLine);

    const onBrowserOnline = () => applyStatus(true);
    const onBrowserOffline = () => applyStatus(false);
    window.addEventListener('online', onBrowserOnline);
    window.addEventListener('offline', onBrowserOffline);

    let handle: { remove: () => void } | undefined;
    void Network.getStatus()
      .then((status) => applyStatus(status.connected))
      .catch(() => undefined);
    void Network.addListener('networkStatusChange', (status) => applyStatus(status.connected))
      .then((listener) => {
        handle = listener;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
      handle?.remove();
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    applyingRemoteRef.current = true;
    let initialMergeDone = false;
    const unsub = subscribeToUserTasks(
      authUser.uid,
      (cloudTasks) => {
        const applyRemote = (next: Task[]) => {
          applyingRemoteRef.current = true;
          setTasks(next);
          saveLocalTasks(next);
          void rescheduleNativeReminders(next);
          markSyncedNow();
          setSyncError(null);
          applyingRemoteRef.current = false;
        };

        if (!initialMergeDone) {
          initialMergeDone = true;
          const local = getLocalTasks();
          if (local.length > 0) {
            const { merged } = mergeTasks(local, cloudTasks);
            const sameLength = merged.length === cloudTasks.length;
            const sameIds = sameLength && merged.every((task) => cloudTasks.some((c) => c.id === task.id && c.updatedAt === task.updatedAt));
            if (!sameIds) {
              applyingRemoteRef.current = true;
              setIsSyncing(true);
              void pushUserTasks(authUser.uid, merged.map((task) => ({ ...task, userId: authUser.uid })))
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : '初回同期に失敗しました。';
                  setSyncError(`初回同期に失敗しました: ${message}`, error);
                })
                .finally(() => setIsSyncing(false));
              applyRemote(merged);
              return;
            }
          }
        }

        applyRemote(cloudTasks);
      },
      (error) => {
        setSyncError('クラウド（Firestore）との同期に失敗しました。', error);
        applyingRemoteRef.current = false;
      }
    );
    return () => {
      unsub();
      applyingRemoteRef.current = false;
    };
  }, [authUser]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => void } | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void rescheduleNativeReminders(getLocalTasks());
      }
    }).then((listener) => {
      handle = listener;
    });
    return () => {
      handle?.remove();
    };
  }, []);

  // --- Task State Updaters ---
  const currentUserId = () => authUserRef.current?.uid || 'local-user';

  const markSyncedNow = () => {
    const nowStr = new Date().toLocaleString('ja-JP');
    setLastSyncTime(nowStr);
  };

  const updateTasksState = (newTasks: Task[]) => {
    const uid = currentUserId();
    const normalized = newTasks.map((task) => (
      uid !== 'local-user' && task.userId !== uid ? { ...task, userId: uid } : task
    ));
    setTasks(normalized);
    saveLocalTasks(normalized);
    void rescheduleNativeReminders(normalized);

    if (uid !== 'local-user' && !applyingRemoteRef.current) {
      setIsSyncing(true);
      setSyncError(null);
      void pushUserTasks(uid, normalized)
        .then(() => {
          markSyncedNow();
        })
        .catch((error: unknown) => {
          console.error('Firestoreへの保存に失敗しました:', error);
          setSyncError('クラウド（Firestore）への保存に失敗しました。', error);
        })
        .finally(() => setIsSyncing(false));
    }
  };

  // --- Trigger Confetti ---
  const triggerConfetti = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#059669', '#10B981', '#34D399', '#6EE7B7', '#A7F3D0'],
    });
  };

  // --- Actions ---
  const handleToggleDarkMode = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    setNotificationsGranted(granted);
    if (granted) {
      alert('リマインダー通知が有効になりました！');
    } else {
      alert('通知の許可を得られませんでした。\nプレビュー（iframe内）ではブラウザのセキュリティ制限により、通知許可が動作しない場合があります。\n画面右上の「新しいタブで開く」等のボタンからアプリを実機または別タブで開いてお試しいただくか、ブラウザのアドレスバーのアイコン（鍵マーク等）から通知設定を許可してください。');
    }
  };

  const handleHeaderSignIn = async () => {
    setIsSigningIn(true);
    setSyncError(null);
    try {
      await googleSignIn();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Googleログインに失敗しました。';
      const detail = (error as { detail?: string } | null)?.detail || errorDetail(error);
      setSyncError(message, error);
      setErrorDialog({ title: 'ログインエラー', message, detail });
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleHeaderSignOut = async () => {
    if (!window.confirm('Googleアカウントからログアウトしますか？ この端末に保存済みのデータはそのまま残ります。')) {
      return;
    }
    try {
      await firebaseLogout();
      setSyncError(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'ログアウトに失敗しました。';
      setSyncError(message, error);
    }
  };

  /** 連携アカウントの変更: ログアウト → アカウント選択付きで再ログイン */
  const handleChangeAccount = async () => {
    if (!window.confirm('連携するGoogleアカウントを変更しますか？\nいったんログアウトし、アカウントの選択画面を表示します。この端末に保存済みのデータはそのまま残ります。')) {
      return;
    }
    try {
      await firebaseLogout();
    } catch (error: unknown) {
      console.warn('ログアウトに失敗しました:', error);
    }
    setLastSyncTime(null);
    setSyncError(null);
    await handleHeaderSignIn();
  };

  const calendarTargets = exportableTasks(tasks);

  /** 権限が許可されていない時の案内（設定画面を開くか確認） */
  const showCalendarPermissionGuide = () => {
    setCalendarPermission('denied');
    if (window.confirm(`${PERMISSION_GUIDE}\n\n「OK」を押すと、このアプリの設定画面（手順4の画面の1つ手前）を開きます。`)) {
      void openCalendarAppSettings().catch(() => undefined);
    }
  };

  /** 端末のカレンダー一覧を読み込み、未選択（または消えた）なら既定のカレンダーを選ぶ */
  const loadDeviceCalendars = async (requestIfNeeded: boolean): Promise<DeviceCalendarInfo[] | null> => {
    if (!isCalendarExportAvailable()) return null;
    try {
      const granted = requestIfNeeded ? await ensureCalendarPermission() : false;
      if (requestIfNeeded && !granted) {
        showCalendarPermissionGuide();
        return null;
      }
      const list = await listWritableCalendars();
      setCalendarPermission('granted');
      setDeviceCalendars(list);
      if (list.length > 0 && !list.some((c) => c.id === selectedCalendarId)) {
        const def = pickDefaultCalendar(list, authUserRef.current?.email);
        if (def) setSelectedCalendarId(def.id);
      }
      return list;
    } catch (error: unknown) {
      if (error instanceof CalendarError && error.code === 'PERMISSION_DENIED') {
        if (requestIfNeeded) showCalendarPermissionGuide();
        else setCalendarPermission('unknown');
        return null;
      }
      const message = error instanceof Error ? error.message : 'カレンダー一覧を取得できませんでした。';
      const detail = error instanceof CalendarError ? error.detail : errorDetail(error);
      setErrorDialog({ title: 'カレンダーの読み込みエラー', message, detail });
      return null;
    }
  };

  // 設定画面を開いたとき、許可済みならカレンダー一覧を読み込む（許可ダイアログは出さない）
  useEffect(() => {
    if (currentView === 'settings' && isCalendarExportAvailable()) {
      void loadDeviceCalendars(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  /** 完了タスクを端末のカレンダーへ終日予定としてエクスポート（Android のみ） */
  const handleExportCalendar = async () => {
    if (!isCalendarExportAvailable()) {
      alert('カレンダーへのエクスポートはAndroidアプリで使えます。');
      return;
    }
    if (calendarTargets.length === 0) {
      alert('エクスポートする完了タスクはありません。');
      return;
    }
    let list = deviceCalendars;
    if (calendarPermission !== 'granted' || !list) {
      list = await loadDeviceCalendars(true);
      if (!list) return;
    }
    if (list.length === 0) {
      alert('書き込みできるカレンダーが端末に見つかりません。\nGoogleカレンダーアプリを開いて、Googleアカウントのカレンダーが表示されることを確認してから、もう一度お試しください。');
      return;
    }
    const target = list.find((c) => c.id === selectedCalendarId) || pickDefaultCalendar(list, authUser?.email);
    if (!target) return;
    if (target.id !== selectedCalendarId) setSelectedCalendarId(target.id);
    const calLabel = `${target.displayName}${target.accountName && target.accountName !== target.displayName ? `（${target.accountName}）` : ''}`;
    if (!window.confirm(
      `まだエクスポートしていない完了タスク ${calendarTargets.length} 件を、カレンダー「${calLabel}」に時間指定なしの予定として登録します。\n\n` +
      '・予定の日付は「完了日」（未入力なら実施予定日）です。\n' +
      '・登録できたタスクには「カレンダー登録済」の印が付き、以後そのタスクを編集・削除してもカレンダーの予定は変わりません。\n' +
      '・Googleアカウントのカレンダーなら、Googleカレンダー側の同期でクラウドにも反映されます。\n\nよろしいですか？'
    )) {
      return;
    }
    setIsExporting(true);
    setExportSummary(null);
    try {
      const outcome = await exportCompletedTasksToDeviceCalendar(tasks, calendarPrefix, target.id);
      const r = outcome.summary;
      // 登録できたタスクにエクスポート済みフラグを立てる（Firestore で他の端末にも同期）
      if (outcome.exportedTaskIds.length > 0) {
        const stamp = new Date().toISOString();
        const ids = new Set(outcome.exportedTaskIds);
        const latest = getLocalTasks();
        const base = latest.length > 0 ? latest : tasks;
        updateTasksState(base.map((t) => (
          ids.has(t.id) ? { ...t, calendarExported: true, calendarExportedAt: stamp, updatedAt: stamp } : t
        )));
      }
      const summary = `登録 ${r.created} 件${r.failed ? `（失敗 ${r.failed} 件）` : ''}${
        outcome.cleanedLegacy ? `・以前の版で登録済みの予定 ${outcome.cleanedLegacy} 件を引き継ぎ` : ''}`;
      setExportSummary(summary);
      if (r.failed) {
        setErrorDialog({ title: 'エクスポートの一部が失敗しました', message: summary, detail: (r.errors || []).join('\n') });
      } else {
        alert(`カレンダー「${target.displayName}」へのエクスポートが完了しました。\n${summary}`);
      }
    } catch (error: unknown) {
      if (error instanceof CalendarError && error.code === 'PERMISSION_DENIED') {
        showCalendarPermissionGuide();
      } else {
        const message = error instanceof Error ? error.message : 'カレンダーへのエクスポートに失敗しました。';
        const detail = error instanceof CalendarError ? error.detail : errorDetail(error);
        setErrorDialog({ title: 'エクスポートエラー', message, detail });
      }
    } finally {
      setIsExporting(false);
    }
  };

  // 同一重要度の中で最後の数値＋１を自動設定
  const getNextPriorityNumber = (letter: PriorityLetter): number | null => {
    if (!letter) return null;
    const sameLetterTasks = tasks.filter(t => t.priorityLetter === letter);
    if (sameLetterTasks.length === 0) return 1;
    const numbers = sameLetterTasks
      .map(t => t.priorityNumber)
      .filter((n): n is number => typeof n === 'number' && !isNaN(n));
    if (numbers.length === 0) return 1;
    const maxNum = Math.max(...numbers);
    return maxNum + 1;
  };

  // タスク内容入力時に実施予定日を自動判定する（重要度・緊急度は登録時に判定）
  const handleQuickTitleChange = (val: string) => {
    setQuickTitle(val);
    const { dueDate: parsedDate } = parseDueDateFromText(val);
    if (parsedDate) {
      setSelectedDate(parsedDate);
    }
  };

  /**
   * 簡易登録の重要度・緊急度を決める。
   * - プルダウン（重要度・緊急度）のどちらかを選んでいる場合: プルダウンの値だけを使い、
   *   タイトル先頭の「A3」などは重要度・緊急度として使わない（二重に付与しない）。
   *   その先頭トークンはタイトルから取り除く（「A1 | A3 会議」のような二重表示を防ぐ）。
   * - プルダウンが両方「自動」の場合: 従来どおりタイトル先頭から自動判定する。
   */
  const resolveQuickPriority = (titleText: string): { letter: PriorityLetter; number: number | null; title: string; source: 'manual' | 'auto' | 'none' } => {
    const parsed = parsePriorityPrefix(titleText);
    const manual = quickLetter !== '' || quickNumber !== null;
    const title = parsed.matched && parsed.rest.trim() ? parsed.rest : titleText.trim();
    if (manual) {
      const number = quickNumber !== null ? quickNumber : (quickLetter ? getNextPriorityNumber(quickLetter) : null);
      return { letter: quickLetter, number, title, source: 'manual' };
    }
    if (parsed.matched) {
      const number = parsed.letterOnly ? getNextPriorityNumber(parsed.letter) : parsed.number;
      return { letter: parsed.letter, number, title, source: 'auto' };
    }
    return { letter: '', number: null, title, source: 'none' };
  };

  // 一覧・簡易登録画面の追加アクション
  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;

    // 先に日付表現を抽出して取り除く
    const { dueDate: parsedDate, cleanedText: parsedTitle } = parseDueDateFromText(quickTitle);
    const resolved = resolveQuickPriority(parsedTitle.trim() || quickTitle.trim());
    const titleText = resolved.title.trim() || parsedTitle.trim() || quickTitle.trim();

    const calculatedQ = getTaskQuadrant(resolved.letter, resolved.number);
    const newTask: Task = {
      id: newTaskId(),
      userId: currentUserId(),
      title: titleText,
      notes: '',
      priorityLetter: resolved.letter,
      priorityNumber: resolved.number,
      quadrant: calculatedQ,
      dueDate: parsedDate || selectedDate,
      reminderTime: '',
      reminderEnabled: false,
      reminderNotified: false,
      completed: false,
      status: 'pending',
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    updateTasksState([newTask, ...tasks]);
    setQuickTitle('');
    setQuickLetter('');
    setQuickNumber(null);
  };

  // 詳細入力画面からの保存アクション
  const handleSaveTaskDetails = (taskData: Omit<Task, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => {
    let nextTasks: Task[];
    const isCompletedNow = taskData.status === 'completed';

    if (editingTaskId) {
      // Edit mode
      const oldTask = tasks.find((t) => t.id === editingTaskId);
      const isStatusChanged = oldTask && oldTask.status !== taskData.status;
      let copiedTask: Task | null = null;
      if (isStatusChanged) {
        copiedTask = checkAndCreateNextDayCopy(taskData, taskData.status, tasks, editingTaskId, currentUserId());
      }

      nextTasks = tasks.map((t) => {
        if (t.id === editingTaskId) {
          const wasCompleted = t.status === 'completed';
          if (!wasCompleted && isCompletedNow) {
            triggerConfetti();
          }
          return {
            ...t,
            ...taskData,
            updatedAt: new Date().toISOString(),
          };
        }
        return t;
      });

      if (copiedTask) {
        nextTasks = [copiedTask, ...nextTasks];
      }
    } else {
      // Add mode
      const newTask: Task = {
        ...taskData,
        id: newTaskId(),
        userId: currentUserId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (isCompletedNow) {
        triggerConfetti();
      }
      
      const copiedTask = checkAndCreateNextDayCopy(newTask, taskData.status, tasks, newTask.id, currentUserId());
      if (copiedTask) {
        nextTasks = [copiedTask, newTask, ...tasks];
      } else {
        nextTasks = [newTask, ...tasks];
      }
    }

    updateTasksState(nextTasks);
    setCurrentView(prevView); // Go back
    setEditingTaskId(null);
  };



  // Task Row Select to Detail Screen Transition
  const handleSelectTaskForDetail = (taskId: string) => {
    setEditingTaskId(taskId);
    setPrevView(currentView === 'detail' ? 'list' : currentView);
    setCurrentView('detail');
  };

  const handleCreateNewTaskDetail = () => {
    setEditingTaskId(null);
    setPrevView(currentView === 'detail' ? 'list' : currentView);
    setCurrentView('detail');
  };

  // Direct inline update of a task field from list
  const handleUpdateTaskFieldDirect = (taskId: string, field: 'status' | 'priority' | 'title', value: any) => {
    let copiedTask: Task | null = null;

    const updated = tasks.map((t) => {
      if (t.id === taskId) {
        let updatedTask = { ...t, updatedAt: new Date().toISOString() };
        if (field === 'status') {
          const nextStatus = value as TaskStatus;
          if (t.status !== nextStatus) {
            copiedTask = checkAndCreateNextDayCopy(t, nextStatus, tasks, t.id, currentUserId());
          }

          updatedTask.status = nextStatus;
          const isCompletedNow = value === 'completed';
          updatedTask.completed = isCompletedNow;
          updatedTask.completedAt = isCompletedNow ? new Date().toISOString() : null;
          updatedTask.completedDate = isCompletedNow ? getLocalDateString() : '';
          if (isCompletedNow) {
            triggerConfetti();
          }
        } else if (field === 'priority') {
          let letter: PriorityLetter = '';
          let num: number | null = null;
          if (value) {
            letter = value.charAt(0) as PriorityLetter;
            const numPart = value.substring(1);
            num = numPart ? parseInt(numPart, 10) : null;
          }
          updatedTask.priorityLetter = letter;
          updatedTask.priorityNumber = num;
          updatedTask.quadrant = getTaskQuadrant(letter, num);
        } else if (field === 'title') {
          updatedTask.title = (value as string).trim();
        }
        return updatedTask;
      }
      return t;
    });

    let finalTasks = updated;
    if (copiedTask) {
      finalTasks = [copiedTask, ...updated];
    }
    updateTasksState(finalTasks);
  };

  // Backup handler
  const handleImportTasks = (imported: Task[]) => {
    const mergedMap = new Map<string, Task>();
    tasks.forEach((t) => mergedMap.set(t.id, t));
    imported.forEach((t) => {
      const existing = mergedMap.get(t.id);
      if (!existing || new Date(t.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
        mergedMap.set(t.id, t);
      }
    });
    updateTasksState(Array.from(mergedMap.values()));
  };

  // --- Calculate Week Days (from baseDateStr for 7 days) ---
  const getWeekDaysList = (baseDateStr: string) => {
    if (!baseDateStr) return [];
    const list = [];
    for (let i = 0; i < 7; i++) {
      list.push(addDays(baseDateStr, i));
    }
    return list;
  };

  const weekDays = getWeekDaysList(selectedDate || getLocalDateString());

  const handleShiftWeek = (offsetWeeks: number) => {
    setSelectedDate(addDays(selectedDate || getLocalDateString(), offsetWeeks * 7));
  };

  // --- Helper to render status cell info ---
  const getStatusBadgeInfo = (status: TaskStatus) => {
    const symbol = getStatusSymbol(status);
    switch (status) {
      case 'completed':
        return { symbol, label: '完了', bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' };
      case 'postponed':
        return { symbol, label: '先送り', bg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' };
      case 'delegated':
        return { symbol, label: '委任', bg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' };
      case 'in_progress':
        return { symbol, label: '進行中', bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' };
      case 'deleted':
        return { symbol, label: '削除', bg: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 line-through' };
      default:
        return { symbol: '', label: '未達成', bg: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-700' };
    }
  };

  // --- Filter Tasks for Main List View ---
  const mainFilteredTasks = tasks.filter((task) => {
    // Quadrant filter
    const q = getTaskQuadrant(task.priorityLetter, task.priorityNumber);
    if (selectedQuadrant && q !== selectedQuadrant) return false;

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchTitle = task.title.toLowerCase().includes(query);
      const matchNotes = task.notes?.toLowerCase().includes(query) || false;
      if (!matchTitle && !matchNotes) return false;
    }

    // Status filter
    if (statusFilter === 'all_active') {
      return task.status !== 'deleted';
    } else if (statusFilter === 'pending_or_progress') {
      return task.status === 'pending' || task.status === 'in_progress';
    } else if (statusFilter === 'all') {
      return true;
    } else {
      return task.status === statusFilter;
    }
  });

  // Sort: Due Date (ascending, empty at bottom), then Priority Letter (A>B>C>none), Number (1>2>3>none), then Title
  const sortedTasks = [...mainFilteredTasks].sort((a, b) => {
    // 1. Due Date sorting (ascending, empty/invalid at bottom)
    const dateA = a.dueDate || '9999-12-31';
    const dateB = b.dueDate || '9999-12-31';
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    // 2. Priority Letter sorting
    const letterWeight = { A: 10, B: 5, C: 2, '': 0 };
    const weightA = letterWeight[a.priorityLetter || ''] || 0;
    const weightB = letterWeight[b.priorityLetter || ''] || 0;
    if (weightA !== weightB) return weightB - weightA;

    // 3. Priority Number sorting
    const numA = a.priorityNumber === null ? 999 : a.priorityNumber;
    const numB = b.priorityNumber === null ? 999 : b.priorityNumber;
    if (numA !== numB) return numA - numB;

    // 4. Title sorting (ascending)
    return (a.title || '').localeCompare(b.title || '');
  });

  // Calculate day-of-week string in Japanese
  const getJPDayOfWeek = (dateStr: string) => {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const d = parseLocalDate(dateStr);
    return weekdays[d.getDay()];
  };

  // Highlight today's date
  const todayStr = getLocalDateString();

  return (
    <div className="app-shell h-[100dvh] sm:h-auto sm:min-h-screen overflow-hidden sm:overflow-visible flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-200" id="matrix-app-container">
      
      {/* Premium Top Line Accent */}
      <div className="h-1 bg-gradient-to-r from-emerald-500 via-zinc-800 to-amber-500 dark:from-emerald-400 dark:via-zinc-100 dark:to-amber-400" />

      {/* Header Bar */}
      <header className="border-b border-zinc-200/60 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md sticky top-0 z-30 flex-none" id="global-header">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img src="./icon-192.png" alt="" className="w-9 h-9 rounded-xl shadow-sm flex-none max-[379px]:hidden" />
            <div className="min-w-0 flex-1">
              <h1 className="text-base sm:text-lg font-black tracking-tight truncate leading-tight" id="app-title">
                ABC ToDo Planner
              </h1>
              <p
                onClick={!authUser && !isSigningIn ? () => void handleHeaderSignIn() : undefined}
                role={!authUser ? 'button' : undefined}
                className={`text-[0.75rem] sm:text-[0.8125rem] font-semibold truncate leading-tight ${!authUser ? 'cursor-pointer underline decoration-dotted underline-offset-2 ' : ''}${
                  !isOnline || (syncError && !isSyncing) ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500 dark:text-zinc-400'
                }`}
                id="header-account-line"
                title={authUser?.email || ''}
              >
                {authUser
                  ? `${authUser.email || authUser.displayName || 'ログイン済み'}${
                      !isOnline
                        ? '・オフライン'
                        : isSyncing
                          ? '・同期中…'
                          : syncError
                            ? '・同期エラー'
                            : lastSyncTime
                              ? `・同期 ${shortSyncTime(lastSyncTime)}`
                              : ''
                    }`
                  : (isSigningIn ? 'ログイン中…' : syncError ? 'ログイン失敗・タップで再試行' : '未ログイン・タップでログイン')}
              </p>
            </div>
            <HeaderStatus
              user={authUser}
              isOnline={isOnline}
              lastSyncTime={lastSyncTime}
              syncError={syncError}
              isSyncing={isSyncing}
              isSigningIn={isSigningIn}
              onSignIn={handleHeaderSignIn}
              onOpenSettings={() => {
                if (currentView !== 'settings') {
                  setPrevView(currentView);
                  setCurrentView('settings');
                }
              }}
              onShowError={() => setErrorDialog({
                title: authUser ? '同期エラーの詳細' : 'ログインエラーの詳細',
                message: syncError || '',
                detail: syncErrorDetail,
              })}
            />
            <button
              onClick={() => {
                if (currentView === 'settings') {
                  setCurrentView(prevView === 'settings' ? 'list' : prevView);
                } else {
                  setPrevView(currentView);
                  setCurrentView('settings');
                }
              }}
              className={`h-9 w-9 flex items-center justify-center rounded-xl border transition-all active:scale-95 flex-none ${
                currentView === 'settings'
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100'
                  : 'text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              title="設定"
              aria-label="設定"
              id="btn-header-settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {errorDialog && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setErrorDialog(null)}
          role="dialog"
          aria-modal="true"
          id="error-detail-dialog"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 p-5 shadow-xl border border-zinc-200 dark:border-zinc-700"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-amber-600 dark:text-amber-400 mb-2">⚠ {errorDialog.title}</h2>
            <p className="text-base text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap break-words">{errorDialog.message}</p>
            {errorDialog.detail && (
              <div className="mt-3">
                <div className="text-sm font-bold text-zinc-500 dark:text-zinc-400">詳細（この画面のスクショを送ってください）</div>
                <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-zinc-100 dark:bg-zinc-800 p-2 text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap break-all select-text">{errorDialog.detail}</pre>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              {errorDialog.detail && typeof navigator !== 'undefined' && navigator.clipboard && (
                <button
                  type="button"
                  className="px-4 py-2 text-base font-bold rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200"
                  onClick={() => { void navigator.clipboard.writeText(`${errorDialog.message}\n${errorDialog.detail}`).catch(() => undefined); }}
                >
                  コピー
                </button>
              )}
              <button
                type="button"
                className="px-4 py-2 text-base font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                onClick={() => setErrorDialog(null)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Dynamic View Panels */}
      <main 
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="w-full min-w-0 max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 flex-1 min-h-0 overflow-y-auto sm:overflow-visible" 
        id="view-panel-viewport"
      >
        
        {/* VIEW 1: 一覧画面 */}
        {currentView === 'list' && (
          <div className="flex flex-col gap-6 animate-fade-in" id="view-list-container">
            
            {/* List & Filtering Table section */}
            <section className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-3.5 sm:p-5 shadow-xs" id="main-list-table-panel">
              
              {/* Filter controls */}
              <div className="flex flex-row items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-2">
                
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className="text-xs font-black tracking-wider uppercase text-zinc-400 dark:text-zinc-500 truncate">
                    <span className="sm:hidden">タスク</span>
                    <span className="hidden sm:inline">タスクプラン一覧</span>
                  </h3>
                  <span className="text-[0.8125rem] font-bold px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-850 rounded-full text-zinc-500">
                    {sortedTasks.length}
                  </span>
                  {selectedQuadrant && (
                    <button
                      onClick={() => setSelectedQuadrant(null)}
                      className="text-[0.8125rem] font-bold text-amber-600 dark:text-amber-400 underline hover:no-underline ml-1 shrink-0"
                    >
                      解除
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 min-w-0">
                  
                  {/* Text search */}
                  <input
                    type="text"
                    placeholder="キーワード検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="hidden md:inline-block px-2.5 py-1 text-[0.875rem] font-medium bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none w-28 sm:w-36 text-zinc-800 dark:text-zinc-200"
                  />

                  {/* Status Dropdown Filter */}
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="min-w-0 max-w-[10.5rem] sm:max-w-none px-2 py-1 text-[0.875rem] font-semibold bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none text-zinc-700 dark:text-zinc-300 h-8 truncate"
                  >
                    <option value="all_active">すべてのタスク (削除除く)</option>
                    <option value="pending_or_progress">未達成・進行中</option>
                    <option value="pending">未達成</option>
                    <option value="in_progress">進行中</option>
                    <option value="completed">完了</option>
                    <option value="postponed">先送り</option>
                    <option value="delegated">委任</option>
                    <option value="deleted">削除</option>
                    <option value="all">すべて (削除含む)</option>
                  </select>

                  {/* Create New Task Detail */}
                  <button
                    onClick={handleCreateNewTaskDetail}
                    className="flex shrink-0 px-2.5 py-1 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-lg text-[0.875rem] font-bold hover:scale-102 transition-all items-center gap-1 shadow-xs h-8"
                  >
                    <Plus className="w-3 h-3" />
                    <span className="hidden xs:inline">詳細作成</span>
                  </button>

                </div>

              </div>

              {/* Task table list */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/50 dark:bg-zinc-800/10 border-b border-zinc-200/50 dark:border-zinc-850 text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 tracking-wider">
                      <th className="w-12 sm:w-24 py-2 px-1 sm:px-3 text-center">
                        <span className="hidden sm:inline">達成状況</span>
                        <span className="sm:hidden block leading-tight text-[0.75rem]">達成<br/>状況</span>
                      </th>
                      <th className="w-10 sm:w-16 py-2 px-1 sm:px-2 text-center">
                        <span className="hidden sm:inline">優先度</span>
                        <span className="sm:hidden block leading-tight text-[0.75rem]">優先<br/>度</span>
                      </th>
                      <th className="py-2 px-2 sm:px-3">タスク内容</th>
                      <th className="w-16 sm:w-28 py-2 px-1 sm:px-3 text-center">期日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {sortedTasks.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-xs text-zinc-400 dark:text-zinc-500">
                          <Inbox className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                          表示するタスクがありません。予定を追加するか、フィルターを変更してください。
                        </td>
                      </tr>
                    ) : (
                      sortedTasks.map((task) => {
                        const statusBadge = getStatusBadgeInfo(task.status || 'pending');
                        const isCompleted = task.status === 'completed';
                        const isDeleted = task.status === 'deleted';

                        return (
                          <tr
                            key={task.id}
                            className={`group hover:bg-zinc-50/60 dark:hover:bg-zinc-800/25 cursor-pointer select-none transition-colors ${
                              isCompleted ? 'opacity-60' : ''
                            } ${isDeleted ? 'bg-red-500/5 opacity-50' : ''}`}
                            onClick={(e) => {
                              if (longPressActiveRef.current) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  longPressActiveRef.current = false;
                                }
                            }}
                            onMouseDown={(e) => {
                              if (e.button === 0) {
                                startLongPress(task.id);
                              }
                            }}
                            onMouseUp={cancelLongPress}
                            onMouseLeave={cancelLongPress}
                            onTouchStart={() => startLongPress(task.id)}
                            onTouchEnd={cancelLongPress}
                            onTouchCancel={cancelLongPress}
                            id={`task-list-row-${task.id}`}
                            title="長押しで詳細・編集を開く"
                          >
                            {/* Status symbol column with button cycling (Requested core interaction) */}
                            <td className="py-2 px-1 sm:px-3 text-center" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                              {inlineEditingTaskId === task.id && inlineEditingField === 'status' ? (
                                <select
                                  value={task.status || 'pending'}
                                  onChange={(e) => {
                                    handleUpdateTaskFieldDirect(task.id, 'status', e.target.value as TaskStatus);
                                    setInlineEditingTaskId(null);
                                    setInlineEditingField(null);
                                  }}
                                  onBlur={() => {
                                    setInlineEditingTaskId(null);
                                    setInlineEditingField(null);
                                  }}
                                  autoFocus
                                  className="px-1 py-0.5 text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none font-bold text-zinc-800 dark:text-zinc-100 shadow-sm"
                                >
                                  <option value="pending">未達成</option>
                                  <option value="in_progress">進行中 (・)</option>
                                  <option value="completed">完了 (✓)</option>
                                  <option value="postponed">先送り (→)</option>
                                  <option value="delegated">委任 (○)</option>
                                  <option value="deleted">削除 (×)</option>
                                </select>
                              ) : (
                                <button
                                  onClick={() => {
                                    setInlineEditingTaskId(task.id);
                                    setInlineEditingField('status');
                                  }}
                                  className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border text-xs font-black transition-all hover:scale-105 active:scale-95 ${statusBadge.bg}`}
                                  title="達成状況を変更"
                                  id={`cycle-btn-${task.id}`}
                                >
                                  {statusBadge.symbol || (
                                    <div className="w-3.5 h-3.5 rounded-full border border-zinc-300 dark:border-zinc-700 hover:border-zinc-400" />
                                  )}
                                </button>
                              )}
                            </td>

                            {/* Priority Letter/Number Badge with inline selector */}
                            <td 
                              className="py-2 px-1 sm:px-2 text-center font-bold text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                setInlineEditingTaskId(task.id);
                                setInlineEditingField('priority');
                              }}
                            >
                              {inlineEditingTaskId === task.id && inlineEditingField === 'priority' ? (
                                <select
                                  value={task.priorityLetter ? `${task.priorityLetter}${task.priorityNumber || ''}` : ''}
                                  onChange={(e) => {
                                    handleUpdateTaskFieldDirect(task.id, 'priority', e.target.value);
                                    setInlineEditingTaskId(null);
                                    setInlineEditingField(null);
                                  }}
                                  onBlur={() => {
                                    setInlineEditingTaskId(null);
                                    setInlineEditingField(null);
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  autoFocus
                                  className="px-1 py-0.5 text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none max-w-[85px] font-black text-zinc-900 dark:text-zinc-100 shadow-sm"
                                >
                                  <option value="">なし</option>
                                  <optgroup label="A (最重要)">
                                    {Array.from({ length: 10 }, (_, i) => `A${i+1}`).map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="B (重要)">
                                    {Array.from({ length: 10 }, (_, i) => `B${i+1}`).map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="C (重要ではない)">
                                    {Array.from({ length: 10 }, (_, i) => `C${i+1}`).map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </optgroup>
                                </select>
                              ) : (
                                <span className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 p-1 rounded-lg transition-all" title="優先度を変更">
                                  {task.priorityLetter ? (
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[0.8125rem] font-black tracking-wide ${
                                      task.priorityLetter === 'A'
                                        ? 'bg-red-500 text-white'
                                        : task.priorityLetter === 'B'
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-zinc-500 text-white'
                                    }`}>
                                      {task.priorityLetter}{task.priorityNumber || ''}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-300 dark:text-zinc-700 px-1">-</span>
                                  )}
                                </span>
                              )}
                            </td>

                            {/* Title & Memo snippet with inline editor */}
                            <td 
                              className="py-2 px-2 sm:px-3 text-xs cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/15 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setInlineEditingTaskId(task.id);
                                setInlineEditingField('title');
                                setInlineEditingTitleValue(task.title);
                              }}
                            >
                              {inlineEditingTaskId === task.id && inlineEditingField === 'title' ? (
                                <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="text"
                                    value={inlineEditingTitleValue}
                                    onChange={(e) => setInlineEditingTitleValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleUpdateTaskFieldDirect(task.id, 'title', inlineEditingTitleValue);
                                        setInlineEditingTaskId(null);
                                        setInlineEditingField(null);
                                      } else if (e.key === 'Escape') {
                                        setInlineEditingTaskId(null);
                                        setInlineEditingField(null);
                                      }
                                    }}
                                    onBlur={() => {
                                      handleUpdateTaskFieldDirect(task.id, 'title', inlineEditingTitleValue);
                                      setInlineEditingTaskId(null);
                                      setInlineEditingField(null);
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    autoFocus
                                    className="w-full px-2.5 py-1 text-xs bg-white dark:bg-zinc-850 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-500 text-zinc-800 dark:text-zinc-100 font-semibold"
                                  />
                                </div>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <span className={`font-semibold text-zinc-800 dark:text-zinc-200 hover:underline ${
                                    isCompleted ? 'line-through text-zinc-400 dark:text-zinc-500' : ''
                                  } ${isDeleted ? 'line-through text-red-500' : ''}`}>
                                    {task.title}
                                  </span>
                                  {task.notes && (
                                    <span className="text-[0.8125rem] text-zinc-400 dark:text-zinc-500 line-clamp-1 max-w-lg">
                                      {task.notes}
                                    </span>
                                  )}
                                  {task.reminderEnabled && task.reminderTime && (
                                    <div className="flex items-center gap-1 text-[0.75rem] text-sky-500 font-bold mt-0.5">
                                      <Clock className="w-2.5 h-2.5" />
                                      <span>通知: {task.reminderTime}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Due Date Column */}
                            <td className="py-2 px-1 sm:px-3 text-center text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500">
                              <span className={task.dueDate === todayStr ? 'text-zinc-900 dark:text-zinc-100 underline decoration-zinc-900 dark:decoration-zinc-100 decoration-2' : ''}>
                                {task.dueDate === todayStr ? (
                                  '今日'
                                ) : (
                                  <>
                                    <span className="hidden sm:inline">{task.dueDate}</span>
                                    <span className="sm:hidden inline">{formatDueDate(task.dueDate)}</span>
                                  </>
                                )}
                              </span>
                            </td>

                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Status symbols guide legend */}
              <div className="mt-5 pt-3 border-t border-zinc-200/60 dark:border-zinc-800 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-zinc-400 dark:text-zinc-500 font-bold" id="status-legends">
                <span>【達成状況 記号対応】</span>
                <span>未達成 (空欄)</span>
                <span className="text-emerald-500 dark:text-emerald-400">完了 (✓)</span>
                <span className="text-sky-500 dark:text-sky-400">先送り (→)</span>
                <span className="text-indigo-500 dark:text-indigo-400">委任 (○)</span>
                <span className="text-amber-500 dark:text-amber-400">進行中 (・)</span>
                <span className="text-red-500 dark:text-red-400">削除 (×)</span>
              </div>

            </section>

          </div>
        )}

        {/* VIEW: 4つの領域 (マトリクス) */}
        {currentView === 'matrix' && (
          <div className="flex flex-col gap-6 animate-fade-in" id="view-matrix-container">
            
            {/* Header / Guide */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
              <h3 className="text-xs font-black tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                時間管理マトリクス
              </h3>
              <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mt-0.5">
                重要度と緊急度でタスクを4つの領域に分類。領域をクリックして絞り込み表示できます。
              </p>
            </div>

            {/* Covey Quadrant Filter Grid (2x2) */}
            <section className="grid grid-cols-2 gap-2 sm:gap-4" id="coovey-matrix-grid">
              {[
                { 
                  id: 'I' as TaskQuadrant, 
                  label: '第Ⅰ領域（必須）', 
                  desc: '重要 かつ 緊急', 
                  sub: '締め切り、突発的な問題、危機対応など。最優先で実施すべき必須事項。',
                  count: tasks.filter(t => getTaskQuadrant(t.priorityLetter, t.priorityNumber) === 'I').length, 
                  color: 'border-red-200 dark:border-red-950/40 bg-red-500/5 hover:bg-red-500/10 text-red-700 dark:text-red-400 ring-red-500/50' 
                },
                { 
                  id: 'II' as TaskQuadrant, 
                  label: '第Ⅱ領域（自己）', 
                  desc: '重要 かつ 緊急ではない', 
                  sub: '自己啓発、計画準備、健康維持、良好な人間関係など。人生の質を高める最も重要な領域。',
                  count: tasks.filter(t => getTaskQuadrant(t.priorityLetter, t.priorityNumber) === 'II').length, 
                  color: 'border-emerald-200 dark:border-emerald-950/40 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/50' 
                },
                { 
                  id: 'III' as TaskQuadrant, 
                  label: '第Ⅲ領域（錯覚）', 
                  desc: '重要ではない かつ 緊急', 
                  sub: '無駄な会議や電話、突然の用事、他者からの依頼など。緊急だが重要ではない事柄。',
                  count: tasks.filter(t => getTaskQuadrant(t.priorityLetter, t.priorityNumber) === 'III').length, 
                  color: 'border-amber-200 dark:border-amber-950/40 bg-amber-500/5 hover:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/50' 
                },
                { 
                  id: 'IV' as TaskQuadrant, 
                  label: '第Ⅳ領域（無駄）', 
                  desc: '重要ではない かつ 緊急ではない', 
                  sub: '時間潰し、過度の娯楽、単なる逃避行動など。成果を生まない、または削減すべき無駄。',
                  count: tasks.filter(t => getTaskQuadrant(t.priorityLetter, t.priorityNumber) === 'IV').length, 
                  color: 'border-zinc-200 dark:border-zinc-800 bg-zinc-500/5 hover:bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 ring-zinc-500/50' 
                },
              ].map((quad) => {
                const isFiltered = selectedQuadrant === quad.id;
                return (
                  <div
                    key={quad.id}
                    onClick={() => setSelectedQuadrant(isFiltered ? null : quad.id)}
                    className={`border rounded-xl p-2.5 sm:p-4 cursor-pointer transition-all ${quad.color} ${
                      isFiltered ? 'ring-2 ring-offset-2 dark:ring-offset-zinc-950 bg-zinc-100 dark:bg-zinc-800/40 border-transparent shadow-xs scale-[1.01]' : ''
                    } flex flex-col justify-center min-h-[56px] sm:min-h-[72px]`}
                  >
                    <div className="flex justify-between items-center gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[0.875rem] sm:text-xs font-black tracking-wide leading-tight break-words">{quad.label}</span>
                        <p className="hidden sm:block text-[0.8125rem] font-bold opacity-80 mt-0.5">{quad.desc}</p>
                      </div>
                      <div className="flex items-center gap-1 sm:gap-1.5 flex-none">
                        <span className="text-[0.75rem] sm:text-[0.8125rem] font-black px-1.5 py-0.5 rounded-full bg-zinc-900/10 dark:bg-zinc-100/10 text-zinc-700 dark:text-zinc-300">
                          {quad.count}件
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuadrantPopup(quad);
                          }}
                          className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors rounded-full hover:bg-zinc-500/10"
                          title={`${quad.label}の説明`}
                        >
                          <HelpCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>

            {/* Quadrant Explanation Popup / Modal */}
            {quadrantPopup && (
              <div 
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in" 
                id="quadrant-popup-modal"
                onClick={() => setQuadrantPopup(null)}
              >
                <div 
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-sm w-full p-5 shadow-xl relative animate-scale-in"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="text-[0.8125rem] font-black tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                        領域の説明
                      </span>
                      <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100 mt-0.5">
                        {quadrantPopup.label}
                      </h3>
                    </div>
                    <button
                      onClick={() => setQuadrantPopup(null)}
                      className="p-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-850">
                      <span className="text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 mr-1.5">性質:</span>
                      <span className="text-xs font-black text-zinc-700 dark:text-zinc-300">{quadrantPopup.desc}</span>
                    </div>
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {quadrantPopup.sub}
                    </p>
                  </div>

                  <div className="mt-5 flex justify-end">
                    <button
                      onClick={() => setQuadrantPopup(null)}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-xs font-black rounded-lg transition-all shadow-xs"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* List of Tasks in Selected Quadrant */}
            <section className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4 mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                    {selectedQuadrant ? `第${selectedQuadrant}領域のタスク一覧` : 'すべての領域のタスク一覧'}
                  </h3>
                  <span className="text-xs font-bold px-2 py-0.5 bg-zinc-100 dark:bg-zinc-850 rounded-full text-zinc-500">
                    {
                      tasks.filter(t => 
                        !selectedQuadrant || getTaskQuadrant(t.priorityLetter, t.priorityNumber) === selectedQuadrant
                      ).length
                    }件
                  </span>
                  {selectedQuadrant && (
                    <button
                      onClick={() => setSelectedQuadrant(null)}
                      className="text-[0.8125rem] font-bold text-amber-600 dark:text-amber-400 underline hover:no-underline ml-1"
                    >
                      選択解除
                    </button>
                  )}
                </div>
              </div>

              {/* Table of tasks */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50/50 dark:bg-zinc-800/10 border-b border-zinc-200/50 dark:border-zinc-850 text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 tracking-wider">
                      <th className="w-12 sm:w-24 py-2 px-1 sm:px-3 text-center">
                        <span className="hidden sm:inline">達成状況</span>
                        <span className="sm:hidden block leading-tight text-[0.75rem]">達成<br/>状況</span>
                      </th>
                      <th className="w-10 sm:w-16 py-2 px-1 sm:px-2 text-center">
                        <span className="hidden sm:inline">優先度</span>
                        <span className="sm:hidden block leading-tight text-[0.75rem]">優先<br/>度</span>
                      </th>
                      <th className="py-2 px-2 sm:px-3">タスク内容</th>
                      <th className="w-16 sm:w-28 py-2 px-1 sm:px-3 text-center">期日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {
                      tasks.filter(t => 
                        !selectedQuadrant || getTaskQuadrant(t.priorityLetter, t.priorityNumber) === selectedQuadrant
                      ).length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-12 text-center text-xs text-zinc-400 dark:text-zinc-500">
                            <Inbox className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                            この領域には該当するタスクがありません。
                          </td>
                        </tr>
                      ) : (
                        [...tasks]
                          .filter(t => 
                            !selectedQuadrant || getTaskQuadrant(t.priorityLetter, t.priorityNumber) === selectedQuadrant
                          )
                          .sort((a, b) => {
                            // 1. Due Date sorting (ascending, empty/invalid at bottom)
                            const dateA = a.dueDate || '9999-12-31';
                            const dateB = b.dueDate || '9999-12-31';
                            if (dateA !== dateB) return dateA.localeCompare(dateB);

                            // 2. Priority Letter sorting
                            const letterWeight = { A: 10, B: 5, C: 2, '': 0 };
                            const weightA = letterWeight[a.priorityLetter || ''] || 0;
                            const weightB = letterWeight[b.priorityLetter || ''] || 0;
                            if (weightA !== weightB) return weightB - weightA;

                            // 3. Priority Number sorting
                            const numA = a.priorityNumber === null ? 999 : a.priorityNumber;
                            const numB = b.priorityNumber === null ? 999 : b.priorityNumber;
                            if (numA !== numB) return numA - numB;

                            // 4. Title sorting (ascending)
                            return (a.title || '').localeCompare(b.title || '');
                          })
                          .map((task) => {
                            const statusBadge = getStatusBadgeInfo(task.status || 'pending');
                            const isCompleted = task.status === 'completed';

                            return (
                              <tr
                                key={task.id}
                                className={`group hover:bg-zinc-50/60 dark:hover:bg-zinc-800/25 cursor-pointer select-none transition-colors ${
                                  isCompleted ? 'opacity-60' : ''
                                }`}
                                onClick={(e) => {
                                  if (longPressActiveRef.current) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    longPressActiveRef.current = false;
                                  }
                                }}
                                onMouseDown={(e) => {
                                  if (e.button === 0) {
                                    startLongPress(task.id);
                                  }
                                }}
                                onMouseUp={cancelLongPress}
                                onMouseLeave={cancelLongPress}
                                onTouchStart={() => startLongPress(task.id)}
                                onTouchEnd={cancelLongPress}
                                onTouchCancel={cancelLongPress}
                                title="長押しで詳細・編集を開く"
                              >
                                <td className="py-2 px-1 sm:px-3 text-center" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                                  {inlineEditingTaskId === task.id && inlineEditingField === 'status' ? (
                                    <select
                                      value={task.status || 'pending'}
                                      onChange={(e) => {
                                        handleUpdateTaskFieldDirect(task.id, 'status', e.target.value as TaskStatus);
                                        setInlineEditingTaskId(null);
                                        setInlineEditingField(null);
                                      }}
                                      onBlur={() => {
                                        setInlineEditingTaskId(null);
                                        setInlineEditingField(null);
                                      }}
                                      autoFocus
                                      className="px-1 py-0.5 text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none font-bold text-zinc-800 dark:text-zinc-100 shadow-sm"
                                    >
                                      <option value="pending">未達成</option>
                                      <option value="in_progress">進行中 (・)</option>
                                      <option value="completed">完了 (✓)</option>
                                      <option value="postponed">先送り (→)</option>
                                      <option value="delegated">委任 (○)</option>
                                      <option value="deleted">削除 (×)</option>
                                    </select>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setInlineEditingTaskId(task.id);
                                        setInlineEditingField('status');
                                      }}
                                      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border text-xs font-black transition-all hover:scale-105 active:scale-95 ${statusBadge.bg}`}
                                      title="達成状況を変更"
                                    >
                                      {statusBadge.symbol || (
                                        <div className="w-3.5 h-3.5 rounded-full border border-zinc-300 dark:border-zinc-700 hover:border-zinc-400" />
                                      )}
                                    </button>
                                  )}
                                </td>

                                {/* Priority Letter/Number Badge with inline selector */}
                                <td 
                                  className="py-2 px-1 sm:px-2 text-center font-bold text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInlineEditingTaskId(task.id);
                                    setInlineEditingField('priority');
                                  }}
                                >
                                  {inlineEditingTaskId === task.id && inlineEditingField === 'priority' ? (
                                    <select
                                      value={task.priorityLetter ? `${task.priorityLetter}${task.priorityNumber || ''}` : ''}
                                      onChange={(e) => {
                                        handleUpdateTaskFieldDirect(task.id, 'priority', e.target.value);
                                        setInlineEditingTaskId(null);
                                        setInlineEditingField(null);
                                      }}
                                      onBlur={() => {
                                        setInlineEditingTaskId(null);
                                        setInlineEditingField(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onTouchStart={(e) => e.stopPropagation()}
                                      autoFocus
                                      className="px-1 py-0.5 text-xs bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none max-w-[85px] font-black text-zinc-900 dark:text-zinc-100 shadow-sm"
                                    >
                                      <option value="">なし</option>
                                      <optgroup label="A (最重要)">
                                        {Array.from({ length: 10 }, (_, i) => `A${i+1}`).map((opt) => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </optgroup>
                                      <optgroup label="B (重要)">
                                        {Array.from({ length: 10 }, (_, i) => `B${i+1}`).map((opt) => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </optgroup>
                                      <optgroup label="C (重要ではない)">
                                        {Array.from({ length: 10 }, (_, i) => `C${i+1}`).map((opt) => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </optgroup>
                                    </select>
                                  ) : (
                                    <span className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 p-1 rounded-lg transition-all" title="優先度を変更">
                                      {task.priorityLetter ? (
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[0.8125rem] font-black tracking-wide ${
                                          task.priorityLetter === 'A'
                                            ? 'bg-red-500 text-white'
                                            : task.priorityLetter === 'B'
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-zinc-500 text-white'
                                        }`}>
                                          {task.priorityLetter}{task.priorityNumber || ''}
                                        </span>
                                      ) : (
                                        <span className="text-zinc-300 dark:text-zinc-700 px-1">-</span>
                                      )}
                                    </span>
                                  )}
                                </td>

                                {/* Title & Memo snippet with inline editor */}
                                <td 
                                  className="py-2 px-2 sm:px-3 text-xs cursor-pointer hover:bg-zinc-50/80 dark:hover:bg-zinc-800/15 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInlineEditingTaskId(task.id);
                                    setInlineEditingField('title');
                                    setInlineEditingTitleValue(task.title);
                                  }}
                                >
                                  {inlineEditingTaskId === task.id && inlineEditingField === 'title' ? (
                                    <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="text"
                                        value={inlineEditingTitleValue}
                                        onChange={(e) => setInlineEditingTitleValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            handleUpdateTaskFieldDirect(task.id, 'title', inlineEditingTitleValue);
                                            setInlineEditingTaskId(null);
                                            setInlineEditingField(null);
                                          } else if (e.key === 'Escape') {
                                            setInlineEditingTaskId(null);
                                            setInlineEditingField(null);
                                          }
                                        }}
                                        onBlur={() => {
                                          handleUpdateTaskFieldDirect(task.id, 'title', inlineEditingTitleValue);
                                          setInlineEditingTaskId(null);
                                          setInlineEditingField(null);
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        autoFocus
                                        className="w-full px-2.5 py-1 text-xs bg-white dark:bg-zinc-850 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-500 text-zinc-800 dark:text-zinc-100 font-semibold"
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex flex-col gap-0.5">
                                      <span className={`font-semibold text-zinc-800 dark:text-zinc-200 hover:underline ${
                                        isCompleted ? 'line-through text-zinc-400 dark:text-zinc-500' : ''
                                      }`}>
                                        {task.title}
                                      </span>
                                      {task.notes && (
                                        <span className="text-[0.8125rem] text-zinc-400 dark:text-zinc-500 line-clamp-1 max-w-lg">
                                          {task.notes}
                                        </span>
                                      )}
                                      {task.reminderEnabled && task.reminderTime && (
                                        <div className="flex items-center gap-1 text-[0.75rem] text-sky-500 font-bold mt-0.5">
                                          <Clock className="w-2.5 h-2.5" />
                                          <span>通知: {task.reminderTime}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>

                                <td className="py-2 px-1 sm:px-3 text-center text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500">
                                  <span className={task.dueDate === todayStr ? 'text-zinc-900 dark:text-zinc-100 underline decoration-zinc-900 dark:decoration-zinc-100 decoration-2' : ''}>
                                    {task.dueDate === todayStr ? (
                                      '今日'
                                    ) : (
                                      <>
                                        <span className="hidden sm:inline">{task.dueDate}</span>
                                        <span className="sm:hidden inline">{formatDueDate(task.dueDate)}</span>
                                      </>
                                    )}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                      )
                    }
                  </tbody>
                </table>
              </div>
            </section>

          </div>
        )}

        {/* VIEW 2: デイリータスク画面 (一週間分の一覧に、各曜日の当日タスクのみを表示) */}
        {currentView === 'daily' && (
          <div className="flex flex-col gap-5 animate-fade-in" id="view-daily-weekly-container">
            
            {/* Week navigation controller */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
              
              <div>
                <h3 className="text-xs font-black tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                  7日間のデイリープランナー
                </h3>
                <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mt-0.5">
                  選択した日から始まる7日間の各曜日のタスクを整理・表示します。
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleShiftWeek(-1)}
                  className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                  title="7日前"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                <span className="text-xs font-bold font-mono tracking-tight whitespace-nowrap text-zinc-800 dark:text-zinc-200 px-3 py-1 bg-zinc-50 dark:bg-zinc-950 rounded-lg">
                  <span className="sm:hidden">{weekDays[0].slice(5).replace('-', '/')} 〜 {weekDays[6].slice(5).replace('-', '/')}</span>
                  <span className="hidden sm:inline">{weekDays[0]} 〜 {weekDays[6]}</span>
                </span>

                <button
                  onClick={() => handleShiftWeek(1)}
                  className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                  title="7日後"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setSelectedDate(getLocalDateString())}
                  className="px-2.5 py-1 text-[0.8125rem] font-bold whitespace-nowrap rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 ml-1 hover:scale-102 transition-all"
                >
                  今日
                </button>
              </div>

            </div>

            {/* Grid of the 7 Days representing the requested layout */}
            <div className="grid grid-cols-1 md:grid-cols-7 gap-3" id="weekly-days-grid">
              {weekDays.map((dateStr) => {
                const isToday = dateStr === todayStr;
                const jpDay = getJPDayOfWeek(dateStr);
                const isWeekend = jpDay === '土' || jpDay === '日';
                
                // Get only tasks for this exact day
                const dayTasks = tasks.filter((t) => t.dueDate === dateStr);
                const completedCount = dayTasks.filter((t) => t.status === 'completed').length;
                const progressPct = dayTasks.length > 0 ? Math.round((completedCount / dayTasks.length) * 100) : 0;

                return (
                  <div
                    key={dateStr}
                    className={`border rounded-xl p-3 flex flex-col justify-between min-h-[300px] transition-all bg-white dark:bg-zinc-900/90 ${
                      isToday
                        ? 'border-zinc-900 dark:border-zinc-100 ring-2 ring-zinc-900/5 dark:ring-zinc-100/5 shadow-xs'
                        : isWeekend
                        ? 'border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30'
                        : 'border-zinc-200/60 dark:border-zinc-800/80'
                    }`}
                  >
                    
                    {/* Day Header */}
                    <div className="border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500">
                          {dateStr.split('-').slice(1).join('/')}
                        </span>
                        {isToday && (
                          <span className="text-[0.75rem] font-black bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 px-1.5 py-0.5 rounded-md tracking-wider">
                            本日
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className={`text-base font-black ${
                          jpDay === '日' ? 'text-red-500' : jpDay === '土' ? 'text-blue-500' : 'text-zinc-800 dark:text-zinc-200'
                        }`}>
                          {jpDay}曜日
                        </span>
                      </div>

                      {/* Micro Progress Bar */}
                      {dayTasks.length > 0 && (
                        <div className="mt-1.5 flex items-center justify-between gap-1">
                          <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 h-1 rounded-full overflow-hidden">
                            <div
                              className="bg-zinc-900 dark:bg-zinc-100 h-full transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                          <span className="text-[0.75rem] font-bold text-zinc-400 font-mono">
                            {progressPct}%
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Day Tasks List Panel */}
                    <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto max-h-[220px] scrollbar-none">
                      {dayTasks.length === 0 ? (
                        <div className="text-[0.8125rem] text-zinc-400/80 dark:text-zinc-600 italic text-center py-8">
                          予定なし
                        </div>
                      ) : (
                        dayTasks.map((t) => {
                          const statusInfo = getStatusBadgeInfo(t.status || 'pending');
                          return (
                            <div
                              key={t.id}
                              onClick={() => handleSelectTaskForDetail(t.id)}
                              className={`group p-2 rounded-lg border border-zinc-100 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-950/40 hover:bg-white dark:hover:bg-zinc-900 cursor-pointer transition-all flex items-start gap-1.5 ${
                                t.status === 'completed' ? 'opacity-55' : ''
                              }`}
                            >
                              
                              {/* Small status symbol inside day block */}
                              <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                                {inlineEditingTaskId === t.id && inlineEditingField === 'status' ? (
                                  <select
                                    value={t.status || 'pending'}
                                    onChange={(e) => {
                                      handleUpdateTaskFieldDirect(t.id, 'status', e.target.value as TaskStatus);
                                      setInlineEditingTaskId(null);
                                      setInlineEditingField(null);
                                    }}
                                    onBlur={() => {
                                      setInlineEditingTaskId(null);
                                      setInlineEditingField(null);
                                    }}
                                    autoFocus
                                    className="px-1 py-0.5 text-[0.8125rem] bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded focus:outline-none font-bold text-zinc-800 dark:text-zinc-100 shadow-sm"
                                  >
                                    <option value="pending">未達成</option>
                                    <option value="in_progress">進行中 (・)</option>
                                    <option value="completed">完了 (✓)</option>
                                    <option value="postponed">先送り (→)</option>
                                    <option value="delegated">委任 (○)</option>
                                    <option value="deleted">削除 (×)</option>
                                  </select>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setInlineEditingTaskId(t.id);
                                      setInlineEditingField('status');
                                    }}
                                    className={`w-5 h-5 rounded border text-[0.75rem] font-black flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${statusInfo.bg}`}
                                    title={`ステータス変更: ${statusInfo.label}`}
                                  >
                                    {statusInfo.symbol || (
                                      <div className="w-2.5 h-2.5 rounded-full border border-zinc-300 dark:border-zinc-700 hover:border-zinc-400" />
                                    )}
                                  </button>
                                )}
                              </div>

                              {/* Title & priority identifier */}
                              <div className="flex-1 min-w-0">
                                <div className="text-[0.875rem] font-bold leading-snug break-words line-clamp-2">
                                  {t.priorityLetter && (
                                    <span className={`inline-block text-[0.75rem] font-black mr-1 rounded-sm px-0.5 ${
                                      t.priorityLetter === 'A'
                                        ? 'bg-red-500/10 text-red-500'
                                        : t.priorityLetter === 'B'
                                        ? 'bg-emerald-500/10 text-emerald-500'
                                        : 'bg-zinc-500/10 text-zinc-500'
                                    }`}>
                                      {t.priorityLetter}{t.priorityNumber || ''}
                                    </span>
                                  )}
                                  <span className={t.status === 'completed' ? 'line-through text-zinc-400 dark:text-zinc-600' : ''}>
                                    {t.title}
                                  </span>
                                </div>
                              </div>

                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Quick registration trigger within the specific day */}
                    <div className="pt-2 mt-2 border-t border-zinc-100 dark:border-zinc-800/60">
                      <button
                        onClick={() => {
                          setSelectedDate(dateStr);
                          setEditingTaskId(null);
                          setPrevView('daily');
                          setCurrentView('detail');
                        }}
                        className="w-full py-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/60 dark:border-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-[0.8125rem] font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-all flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>予定を作成</span>
                      </button>
                    </div>

                  </div>
                );
              })}
            </div>

            {/* Quick Summary Guidelines footer */}
            <div className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl flex items-start gap-3">
              <HelpCircle className="w-5 h-5 text-zinc-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed font-semibold">
                <span className="font-bold text-zinc-800 dark:text-zinc-200 block mb-0.5">
                  週プランナーの使い方
                </span>
                このビューは一週間分のカレンダーマトリクスを並べ、各曜日に直接割り当てられたタスクを厳密に抽出して一覧表示します。タスク内のステータス記号をクリックして完了（✓）や進行中（・）などに素早くサイクル切り替えできるほか、タスクボックスをクリックすることで詳細入力画面へと遷移し編集を行えます。
              </div>
            </div>

          </div>
        )}

        {/* VIEW: 設定画面 (すべての画面上部から移動された通知許可〜読み込み設定) */}
        {currentView === 'settings' && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-4 sm:p-6 shadow-xs max-w-2xl mx-auto animate-fade-in" id="view-settings-container">
            <h2 className="text-base font-black text-zinc-800 dark:text-zinc-100 mb-6 flex items-center gap-2 pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <Settings className="w-5 h-5 text-zinc-500" />
              <span className="flex-1">設定</span>
              <button
                type="button"
                onClick={() => setCurrentView(prevView === 'settings' ? 'list' : prevView)}
                className="w-10 h-10 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 flex items-center justify-center shadow-md active:scale-95"
                aria-label="設定を閉じる"
                title="閉じる"
                id="btn-close-settings"
              >
                <X className="w-5 h-5" strokeWidth={3} />
              </button>
            </h2>

            {/* Google アカウント連携 */}
            <div className="mb-6" id="settings-account">
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                連携しているGoogleアカウント
              </h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl flex flex-col gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center flex-none overflow-hidden">
                    {authUser?.photoURL ? (
                      <img src={authUser.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <UserRound className="w-5 h-5 text-zinc-500" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-zinc-800 dark:text-zinc-100 break-all" id="settings-account-email">
                      {authUser ? (authUser.email || authUser.displayName || 'ログイン済み') : '未ログイン'}
                    </div>
                    <div className="text-[0.8125rem] font-semibold text-zinc-500 dark:text-zinc-400">
                      {authUser
                        ? (!isOnline ? 'オフライン' : isSyncing ? '同期中…' : syncError ? '同期エラー' : lastSyncTime ? `最終同期 ${lastSyncTime}` : 'クラウド同期中')
                        : 'この端末のみに保存しています'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {authUser ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleChangeAccount()}
                        disabled={isSigningIn}
                        className="px-4 py-2 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-xl text-xs font-bold disabled:opacity-60"
                        id="btn-change-account"
                      >
                        {isSigningIn ? '接続中…' : 'アカウントを変更'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleHeaderSignOut()}
                        className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-xl text-xs font-bold flex items-center gap-1.5"
                        id="btn-settings-signout"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        ログアウト
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleHeaderSignIn()}
                      disabled={isSigningIn}
                      className="px-4 py-2 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-xl text-xs font-bold disabled:opacity-60"
                      id="btn-settings-signin"
                    >
                      {isSigningIn ? '接続中…' : 'Googleでログイン'}
                    </button>
                  )}
                  {syncError && (
                    <button
                      type="button"
                      onClick={() => setErrorDialog({ title: authUser ? '同期エラーの詳細' : 'ログインエラーの詳細', message: syncError, detail: syncErrorDetail })}
                      className="px-4 py-2 border border-amber-300 text-amber-700 dark:text-amber-400 rounded-xl text-xs font-bold"
                    >
                      ⚠ エラーの詳細
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* カレンダーへエクスポート（Android のみ・端末内カレンダーへ書き込み） */}
            <div className="mb-6" id="settings-export">
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                エクスポート（カレンダー）
              </h3>
              {!isCalendarExportAvailable() ? (
                <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl text-[0.875rem] font-semibold text-zinc-500 dark:text-zinc-400 flex items-start gap-2" id="calendar-export-web-note">
                  <CalendarPlus className="w-4 h-4 mt-0.5 flex-none" />
                  <span>カレンダーへのエクスポートはAndroidアプリで使えます。</span>
                </div>
              ) : (
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl flex flex-col gap-3">
                <p className="text-[0.875rem] text-zinc-500 dark:text-zinc-400 leading-normal font-semibold">
                  完了したタスクだけを、この端末のカレンダーに時間指定なし（終日）の予定として登録します。Googleアカウントのカレンダーを選べば、Googleカレンダーの同期でクラウドにも反映されます。予定の日付は完了日（未入力なら実施予定日）、予定の詳細にはタスクの「メモ・詳細」だけが入ります（カレンダーに余計な情報は書き込みません）。登録できたタスクには「カレンダー登録済」の印が付き、次回からは対象外になります（重複登録しません）。印が付いたタスクを後で編集・削除しても、カレンダーの予定は変わりません。
                </p>
                <div>
                  <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-1" htmlFor="calendar-select">
                    登録先のカレンダー
                  </label>
                  {deviceCalendars && deviceCalendars.length > 0 ? (
                    <select
                      id="calendar-select"
                      value={selectedCalendarId}
                      onChange={(e) => setSelectedCalendarId(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none font-semibold"
                    >
                      {deviceCalendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName}{c.accountName && c.accountName !== c.displayName ? `（${c.accountName}）` : ''}{c.isPrimary ? ' ★' : ''}
                        </option>
                      ))}
                    </select>
                  ) : deviceCalendars && deviceCalendars.length === 0 ? (
                    <div className="text-[0.8125rem] font-semibold text-amber-700 dark:text-amber-400">
                      書き込みできるカレンダーが見つかりません。Googleカレンダーアプリを開いて、Googleアカウントのカレンダーが表示されることを確認してください。
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void loadDeviceCalendars(true)}
                      className="px-4 py-2 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-xl text-xs font-bold"
                      id="btn-calendar-permission"
                    >
                      {calendarPermission === 'denied' ? 'カレンダーへのアクセスを許可する（設定の案内）' : 'カレンダーへのアクセスを許可して一覧を読み込む'}
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-1" htmlFor="calendar-prefix">
                    プレフィックス（予定名の先頭に付ける文字）
                  </label>
                  <input
                    id="calendar-prefix"
                    type="text"
                    value={calendarPrefix}
                    onChange={(e) => setCalendarPrefix(e.target.value)}
                    placeholder="例: [ABC]"
                    maxLength={30}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-200 font-semibold"
                  />
                  <div className="mt-2 text-[0.8125rem] font-semibold text-zinc-500 dark:text-zinc-400">
                    予定名の形式: プレフィックス＋重要度＋緊急度＋タスク名＋（完了予定日）
                  </div>
                  <div className="mt-1 px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-dashed border-zinc-300 dark:border-zinc-700 text-sm font-bold text-zinc-800 dark:text-zinc-100 break-all" id="calendar-title-preview">
                    {(() => {
                      const sample = calendarTargets[0] || { title: '企画書を提出', priorityLetter: 'A' as PriorityLetter, priorityNumber: 1, dueDate: getLocalDateString() };
                      return `例）${buildEventTitle(sample, calendarPrefix)}`;
                    })()}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleExportCalendar()}
                    disabled={isExporting}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-60 shadow-sm"
                    id="btn-export-calendar"
                  >
                    <CalendarPlus className="w-4 h-4" />
                    {isExporting ? 'エクスポート中…' : 'カレンダーへエクスポート'}
                  </button>
                  <span className="text-[0.8125rem] font-semibold text-zinc-500 dark:text-zinc-400">
                    未エクスポートの完了タスク: {calendarTargets.length} 件
                  </span>
                </div>
                {exportSummary && (
                  <div className="text-[0.8125rem] font-bold text-emerald-700 dark:text-emerald-400" id="calendar-export-summary">
                    前回の結果: {exportSummary}
                  </div>
                )}
              </div>
              )}
            </div>

            {/* Theme setting */}
            <div className="mb-6">
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                テーマ設定
              </h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                    表示テーマの切り替え
                  </span>
                  <p className="text-[0.875rem] text-zinc-500 dark:text-zinc-400 leading-normal font-semibold">
                    ライトモードとダークモードを切り替えます。選択したテーマはブラウザに自動保存されます。
                  </p>
                </div>
                <button
                  onClick={handleToggleDarkMode}
                  className="self-start sm:self-center px-4 py-2 bg-white hover:bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-100 border border-zinc-200/60 dark:border-zinc-800 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2"
                >
                  {darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500" />}
                  <span>{darkMode ? 'ライトモードにする' : 'ダークモードにする'}</span>
                </button>
              </div>
            </div>

            {/* Notification setting */}
            <div className="mb-6">
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                通知設定
              </h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full ${notificationsGranted ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
                      リマインダープッシュ通知
                    </span>
                  </div>
                  <p className="text-[0.875rem] text-zinc-500 dark:text-zinc-400 leading-normal font-semibold">
                    タスクに設定された通知時間になったら、ブラウザからデスクトップ・スマートフォンの通知画面へリマインダーを配信します。
                  </p>
                </div>
                {notificationsGranted ? (
                  <span className="self-start sm:self-center px-3 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 rounded-lg text-xs font-extrabold border border-emerald-200/40 dark:border-emerald-800/40 flex items-center gap-1.5">
                    有効
                  </span>
                ) : (
                  <button
                    onClick={handleRequestPermission}
                    className="self-start sm:self-center px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950 rounded-lg text-xs font-bold transition-all shadow-xs"
                  >
                    通知許可を有効にする
                  </button>
                )}
              </div>
            </div>

            {/* Backup/Import Setting */}
            <div className="mb-6">
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                データのバックアップと移行
              </h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl">
                <p className="text-[0.875rem] text-zinc-500 dark:text-zinc-400 leading-normal font-semibold mb-4">
                  ログイン中は Google アカウントごとにクラウドへ同期されます。未ログイン時はこの端末内に保存されます。
                  追加のバックアップとして、JSON / CSV の書き出し・読み込みと Google ドライブへの保存も利用できます。
                </p>
                <div className="pt-2 border-t border-zinc-200/50 dark:border-zinc-800">
                  <BackupButton tasks={tasks} onImport={handleImportTasks} />
                </div>
              </div>
            </div>

            {/* System Info */}
            <div>
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                システム情報
              </h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl text-[0.875rem] font-semibold text-zinc-500 dark:text-zinc-400 leading-relaxed space-y-1">
                <div>アプリ名: ABC ToDo Planner</div>
                <div id="settings-build-version">ビルドバージョン: {appVersionLabel}</div>
                <div>データストレージ: この端末のキャッシュ ＋ Google アカウントでログインするとクラウド同期</div>
              </div>
            </div>

          </div>
        )}

        {/* VIEW 3: 詳細入力画面 (簡易登録画面の一覧から、一行選択して詳細入力画面へ遷移、または新規作成) */}
        {currentView === 'detail' && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl px-4 pt-4 sm:px-6 sm:pt-6 shadow-xs max-w-2xl mx-auto animate-fade-in" id="view-detail-container">
            <TaskForm
              task={tasks.find((t) => t.id === editingTaskId) || null}
              defaultDate={selectedDate}
              onSave={handleSaveTaskDetails}
              onCancel={() => {
                setCurrentView(prevView);
                setEditingTaskId(null);
              }}
              onDelete={(id) => {
                updateTasksState(tasks.filter((t) => t.id !== id));
                setCurrentView(prevView);
                setEditingTaskId(null);
              }}
            />
          </div>
        )}

      </main>

      {/* BOTTOM SECTION: Navigation Tabs & Quick Registration (Visible on non-detail views) */}
      {currentView !== 'detail' && (
        <div className="app-bottom w-full max-w-6xl mx-auto flex-none flex flex-col-reverse sm:flex-col gap-3 sm:gap-6 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80 px-3 pt-3 sm:px-4 sm:pt-0 sm:bg-transparent sm:dark:bg-transparent sm:border-t-0" id="bottom-controls-section">
          
          {/* Tab switching buttons */}
          <div className="border-0 sm:border-t border-zinc-200/60 dark:border-zinc-800 pt-0 sm:pt-6 w-full">
            <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl max-w-lg mx-auto gap-1" id="bottom-navigation-tabs">
              {([
                { view: 'daily', label: 'デイリー' },
                { view: 'matrix', label: '4つの領域' },
                { view: 'list', label: '一覧' },
              ] as const).map((tab) => (
                <button
                  key={tab.view}
                  onClick={() => {
                    setCurrentView(tab.view);
                    if (tab.view === 'list') setSelectedQuadrant(null);
                  }}
                  className={`flex-1 py-2.5 text-xs font-bold rounded-lg transition-all ${
                    currentView === tab.view
                      ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs font-extrabold border border-zinc-200/40 dark:border-zinc-700/50'
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                  id={`tab-${tab.view}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* 予定の簡易登録 (Quick Registration Panel) */}
          {(currentView === 'list' || currentView === 'matrix' || currentView === 'daily') && (
            <section className="bg-transparent sm:bg-white dark:bg-transparent sm:dark:bg-zinc-900 border-0 sm:border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-0 sm:p-5 shadow-none sm:shadow-xs w-full" id="quick-register-panel">
              <h3 className="hidden sm:block text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-3 tracking-wider uppercase">
                予定の簡易登録
              </h3>
              
              <form onSubmit={handleQuickAdd} className="flex flex-row gap-1.5 sm:gap-2.5 items-end w-full" id="quick-add-form">

                {/* 1. 重要度（空欄=自動判定） */}
                <div className="relative flex-none w-[70px] sm:w-32">
                  <label className="hidden sm:block text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 mb-1" htmlFor="quick-letter">
                    重要度
                  </label>
                  <select
                    id="quick-letter"
                    aria-label="重要度"
                    value={quickLetter}
                    onChange={(e) => {
                      const letter = e.target.value as PriorityLetter;
                      setQuickLetter(letter);
                      setQuickNumber(letter ? getNextPriorityNumber(letter) : null);
                    }}
                    className={`w-full h-10 pl-2 pr-5 sm:pl-3 appearance-none text-xs bg-zinc-50 dark:bg-zinc-950 border rounded-xl focus:outline-none font-bold ${
                      quickLetter ? 'border-zinc-900 dark:border-zinc-200 text-zinc-900 dark:text-zinc-50' : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500'
                    }`}
                  >
                    <option value="">重要度</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1.5 bottom-3 w-3.5 h-3.5 text-zinc-400" />
                </div>

                {/* 2. 緊急度（空欄=自動判定） */}
                <div className="relative flex-none w-[70px] sm:w-28">
                  <label className="hidden sm:block text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 mb-1" htmlFor="quick-number">
                    緊急度
                  </label>
                  <select
                    id="quick-number"
                    aria-label="緊急度"
                    value={quickNumber === null ? '' : quickNumber}
                    onChange={(e) => setQuickNumber(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                    className={`w-full h-10 pl-2 pr-5 sm:pl-3 appearance-none text-xs bg-zinc-50 dark:bg-zinc-950 border rounded-xl focus:outline-none font-bold ${
                      quickNumber !== null ? 'border-zinc-900 dark:border-zinc-200 text-zinc-900 dark:text-zinc-50' : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500'
                    }`}
                  >
                    <option value="">緊急度</option>
                    {Array.from({ length: Math.max(30, (quickNumber || 0) + 10) }, (_, i) => i + 1).map((val) => (
                      <option key={val} value={val}>{val}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1.5 bottom-3 w-3.5 h-3.5 text-zinc-400" />
                </div>

                {/* 3. Task Title Input */}
                <div className="flex-1 min-w-0">
                  <label className="hidden sm:block text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 mb-1" htmlFor="quick-title">
                    タスク内容
                  </label>
                  <input
                    id="quick-title"
                    type="text"
                    required
                    value={quickTitle}
                    onChange={(e) => handleQuickTitleChange(e.target.value)}
                    placeholder="予定を自動判定で登録..."
                    className="w-full h-10 px-2.5 sm:px-3.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-200 text-zinc-800 dark:text-zinc-100 font-semibold"
                  />
                </div>

                {/* 4. Scheduled Date Input */}
                <div className="hidden sm:block w-full md:w-40">
                  <label className="block text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 mb-1" htmlFor="quick-date">
                    実施予定日
                  </label>
                  <input
                    id="quick-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                    className="w-full h-10 px-2.5 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none text-zinc-800 dark:text-zinc-200 font-semibold"
                  />
                </div>

                {/* Quick Add Submit Button */}
                <button
                  type="submit"
                  className="h-10 w-10 sm:w-auto sm:px-5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-xl text-xs font-bold hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-1 shadow-sm flex-none"
                  id="btn-quick-add"
                  aria-label="追加"
                >
                  <Plus className="w-5 h-5 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">追加</span>
                </button>

              </form>

              {/* 重要度・緊急度の判定結果（入力中のみ表示） */}
              {(() => {
                const r = resolveQuickPriority(parseDueDateFromText(quickTitle).cleanedText.trim() || quickTitle.trim());
                const q = getTaskQuadrant(r.letter, r.number);
                const qLabel = q === 'I' ? '第Ⅰ領域（必須）' : q === 'II' ? '第Ⅱ領域（自己投資）' : q === 'III' ? '第Ⅲ領域（錯覚）' : '第Ⅳ領域（無駄）';
                const pr = `${r.letter}${r.number ?? ''}` || 'なし';
                if (!quickTitle.trim() && r.source !== 'manual') {
                  return (
                    <div className="hidden sm:flex mt-2 items-center gap-1 text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                      <span>重要度・緊急度が「自動」のときは、先頭の「A3 」などから自動判定します</span>
                    </div>
                  );
                }
                return (
                  <div className="mt-1.5 sm:mt-2 flex items-center gap-1 text-[0.75rem] sm:text-[0.8125rem] font-bold text-zinc-500 dark:text-zinc-400 truncate" id="quick-priority-hint">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500 flex-none" />
                    <span className="truncate">
                      {r.source === 'manual' ? '選択' : r.source === 'auto' ? '自動判定' : '判定'}: {pr}・{qLabel}
                      {r.source === 'manual' && parsePriorityPrefix(quickTitle).matched ? '（文頭の優先度は使いません）' : ''}
                    </span>
                  </div>
                );
              })()}

            </section>
          )}

        </div>
      )}

    </div>
  );
}
