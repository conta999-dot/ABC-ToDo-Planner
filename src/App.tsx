import React, { useState, useEffect, useRef, useMemo } from 'react';
import confetti from 'canvas-confetti';
import {
  Plus,
  Moon,
  Sun,
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

import { Task, PriorityLetter, TaskQuadrant, TaskStatus, getTaskQuadrant } from './types';
import { getLocalTasks, saveLocalTasks } from './lib/db';
import {
  startReminderScheduler,
  stopReminderScheduler,
  requestNotificationPermission,
  checkNotificationPermission,
  rescheduleNativeReminders,
  scheduleDailyNow,
  isDailyNotifyEnabled,
  getDailyNotifyTime,
  setDailyNotifySettings,
  buildDailySummary,
} from './lib/reminder';
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
  loadCalendarPrefix,
  groupCalendars,
  calendarGroupKey,
  findCalendarByName,
  refreshDeviceCalendars,
  enableCalendarSync,
  GOOGLE_CREATE_CALENDAR_URL,
  eventDateOf,
  loadExportHistory,
  findAppEvents,
  deleteAppEvents,
  AppEventInfo,
  ExportHistoryEntry,
} from './lib/calendar';
import { errorDetail } from './lib/nativeGoogleAuth';
import { Browser } from '@capacitor/browser';
import { subscribeToUserTasks, pushUserTasks } from './lib/sync';
import { mergeTasks } from './lib/merge';
import { isAutoBackupAvailable, runAutoBackup } from './lib/autoBackup';

// Supporting Components (Inlined or imported cleanly)
import BackupButton from './components/BackupButton';
import TaskForm from './components/TaskForm';
import {
  TaskRow,
  TaskRowHeader,
  TaskRowHandlers,
  SortToggle,
  SortDir,
  StatusFilterSelect,
  DragGhost,
  compareTasks,
  matchesStatusFilter,
} from './components/TaskRow';
import { DayTaskScroll } from './components/DayTaskScroll';
import { useTaskDrag, DropTarget } from './lib/useTaskDrag';
import { priorityForQuadrant, QUADRANT_DROP_RULE } from './lib/quadrantMove';

/** 画面幅の判定（レイアウト切り替え用） */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** 4つの領域の表示設定 */
const QUADRANT_CONFIGS: { id: TaskQuadrant; label: string; desc: string; sub: string; drop: string; color: string }[] = [
  {
    id: 'I',
    label: '第Ⅰ領域（必須）',
    desc: '重要 かつ 緊急',
    sub: '締め切り、突発的な問題、危機対応など。最優先で実施すべき必須事項。',
    drop: QUADRANT_DROP_RULE.I,
    color: 'border-red-200 dark:border-red-950/60 bg-red-500/5 text-red-700 dark:text-red-400 ring-red-500/50',
  },
  {
    id: 'II',
    label: '第Ⅱ領域（自己）',
    desc: '重要 かつ 緊急ではない',
    sub: '自己啓発、計画準備、健康維持、良好な人間関係など。人生の質を高める最も重要な領域。',
    drop: QUADRANT_DROP_RULE.II,
    color: 'border-emerald-200 dark:border-emerald-950/60 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 ring-emerald-500/50',
  },
  {
    id: 'III',
    label: '第Ⅲ領域（錯覚）',
    desc: '重要ではない かつ 緊急',
    sub: '無駄な会議や電話、突然の用事、他者からの依頼など。緊急だが重要ではない事柄。',
    drop: QUADRANT_DROP_RULE.III,
    color: 'border-amber-200 dark:border-amber-950/60 bg-amber-500/5 text-amber-700 dark:text-amber-400 ring-amber-500/50',
  },
  {
    id: 'IV',
    label: '第Ⅳ領域（無駄）',
    desc: '重要ではない かつ 緊急ではない',
    sub: '時間潰し、過度の娯楽、単なる逃避行動など。成果を生まない、または削減すべき無駄。',
    drop: QUADRANT_DROP_RULE.IV,
    color: 'border-zinc-200 dark:border-zinc-800 bg-zinc-500/5 text-zinc-600 dark:text-zinc-400 ring-zinc-500/50',
  },
];

const WEEKDAY_JP = ['日', '月', '火', '水', '木', '金', '土'];
/** 週の範囲表示: 11/20(金) */
const fmtRangeDate = (d: string) => {
  if (!d) return '';
  const dt = parseLocalDate(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}(${WEEKDAY_JP[dt.getDay()]})`;
};

/** 初期表示タブ: Web・Android とも「デイリー」（v0.6.1） */
const INITIAL_VIEW: 'list' | 'daily' = 'daily';


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
  // 文中・文末の「B1」「Ｂ２」なども明示指定として扱う（前後が空白か文頭・文末の独立した語だけ）
  const mid = normalized.match(/(^|[\s　])([A-Ca-c])([0-9]{1,2})(?=[\s　]|$)/);
  if (mid && mid.index !== undefined) {
    const n = parseInt(mid[3], 10);
    if (n >= 1 && n <= 20) {
      const start = mid.index + mid[1].length;
      const end = start + 1 + mid[3].length;
      const rest = (original.substring(0, start) + original.substring(end)).replace(/[\s　]{2,}/g, ' ').trim();
      return { letter: mid[2].toUpperCase() as PriorityLetter, number: n, rest, matched: true, letterOnly: false };
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
  const [currentView, setCurrentView] = useState<'list' | 'matrix' | 'detail' | 'daily' | 'settings'>(INITIAL_VIEW);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [prevView, setPrevView] = useState<'list' | 'matrix' | 'detail' | 'daily' | 'settings'>(INITIAL_VIEW);
  
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
  const [dailyNotifyOn, setDailyNotifyOn] = useState<boolean>(() => isDailyNotifyEnabled());
  const [dailyNotifyTime, setDailyNotifyTime] = useState<string>(() => getDailyNotifyTime());
  const [dailyNotifyInfo, setDailyNotifyInfo] = useState<string | null>(null);
  const [quadrantPopup, setQuadrantPopup] = useState<(typeof QUADRANT_CONFIGS)[number] | null>(null);
  const [showDailyHelp, setShowDailyHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2600);
  };
  // 期日の並べ替え（全タブ共通）。起動時は毎回「期日の降順・同じ日は重要度・緊急度の昇順」
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const toggleSortDir = () => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  const isWide = useMediaQuery('(min-width: 768px)');
  const isXL = useMediaQuery('(min-width: 1280px)');
  // v0.6.8: デイリー（7日間）の表示設定。PC（横1280px以上）は7日を横1列に並べ、行を詰める
  const [dailyDensity, setDailyDensity] = useState<'one' | 'two'>(() => {
    try {
      return localStorage.getItem('abc_daily_density') === 'two' ? 'two' : 'one';
    } catch {
      return 'one';
    }
  });
  const [dailyCollapseDone, setDailyCollapseDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem('abc_daily_collapse_done') !== '0';
    } catch {
      return true;
    }
  });
  const [expandedDoneDays, setExpandedDoneDays] = useState<Set<string>>(() => new Set());
  const changeDailyDensity = (v: 'one' | 'two') => {
    setDailyDensity(v);
    try {
      localStorage.setItem('abc_daily_density', v);
    } catch {
      // ignore
    }
  };
  const changeDailyCollapseDone = (v: boolean) => {
    setDailyCollapseDone(v);
    try {
      localStorage.setItem('abc_daily_collapse_done', v ? '1' : '0');
    } catch {
      // ignore
    }
  };
  const toggleDoneDay = (d: string) =>
    setExpandedDoneDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

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
  const [calendarPrefix, setCalendarPrefix] = useState<string>(() => loadCalendarPrefix());
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
  const [exportHistory, setExportHistory] = useState<ExportHistoryEntry[]>(() => loadExportHistory());
  const [appEvents, setAppEvents] = useState<AppEventInfo[] | null>(null);
  const [appEventSelection, setAppEventSelection] = useState<Set<string>>(new Set());
  const [isSearchingEvents, setIsSearchingEvents] = useState(false);
  // 登録先カレンダー: 種類（アカウント）の絞り込みと、名前の自由入力
  const [calendarGroupFilter, setCalendarGroupFilter] = useState<string>('');
  const [calendarNameInput, setCalendarNameInput] = useState('');
  const [calendarNameStatus, setCalendarNameStatus] = useState<{ kind: 'ok' | 'notfound' | 'info'; text: string } | null>(null);
  const [isRefreshingCalendars, setIsRefreshingCalendars] = useState(false);
  // ビルドバージョン（Android はアプリ情報、Web はビルド時に埋め込んだ値）
  const [appVersionLabel, setAppVersionLabel] = useState<string>(`${__APP_VERSION__}（Web ビルド ${__BUILD_COMMIT__}・${__BUILD_TIME__}）`);
  const authUserRef = useRef<User | null>(null);
  const applyingRemoteRef = useRef(false);

  // Swipe navigation states
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    if (drag.isDragBusy()) {
      // タスクのドラッグ中はタブ切り替えのスワイプにしない
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
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
    void checkNotificationPermission().then(setNotificationsGranted);

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
        void runDailyBackup(true);
      }
    }).then((listener) => {
      handle = listener;
    });
    // 起動時: その日の最初ならバックアップ（読み込みが落ち着くまで少し待つ）
    const t = setTimeout(() => void runDailyBackup(true), 3000);
    return () => {
      handle?.remove();
      clearTimeout(t);
    };
  }, []);

  // その日のうちにタスクが変わったら、今日のバックアップファイルを更新（1日1ファイル・30秒まとめて）
  const backupSkipFirstRef = useRef(true);
  useEffect(() => {
    if (!isAutoBackupAvailable()) return;
    if (backupSkipFirstRef.current) {
      backupSkipFirstRef.current = false;
      return;
    }
    const t = setTimeout(() => void runDailyBackup(false), 30000);
    return () => clearTimeout(t);
  }, [tasks]);

  /** Android の自動バックアップ（端末の ドキュメント/ABCToDoPlanner、1日1ファイル） */
  async function runDailyBackup(onlyIfDue: boolean) {
    if (!isAutoBackupAvailable()) return;
    const st = await runAutoBackup(getLocalTasks(), { onlyIfDue });
    if (st) window.dispatchEvent(new Event('abc-auto-backup'));
  }

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

  /** 毎日の通知: オン・オフと時刻の変更（変更したらすぐ予約し直す。オフなら予約をすべて取り消す） */
  const applyDailyNotify = async (on: boolean, time: string) => {
    setDailyNotifyOn(on);
    setDailyNotifyTime(time);
    setDailyNotifySettings(on, time);
    setDailyNotifyInfo(null);
    let granted = await checkNotificationPermission();
    if (on && !granted) {
      granted = await requestNotificationPermission();
      if (!granted) {
        setDailyNotifyInfo(
          Capacitor.isNativePlatform()
            ? '通知が許可されていません。次の手順で許可してください。\n1. Android の「設定」アプリを開く\n2.「アプリ」→「ABC ToDo Planner」をタップ\n3.「通知」をタップ\n4.「ABC ToDo Planner のすべての通知」をオンにする'
            : 'ブラウザの通知が許可されていません。アドレスバー左のアイコン（鍵マークなど）→「通知」→「許可」にしてください。',
        );
      }
    }
    setNotificationsGranted(granted);
    if (Capacitor.isNativePlatform()) {
      const n = await scheduleDailyNow(getLocalTasks());
      if (on && granted) setDailyNotifyInfo(`毎日 ${time} ごろにまとめて通知します。タスクごとの通知も含めて ${n} 件を予約しました（数分遅れることがあります）。`);
      if (!on) setDailyNotifyInfo('通知をオフにしました（予約をすべて取り消しました）。');
    } else if (on && granted) {
      setDailyNotifyInfo(`このページを開いている間、毎日 ${time} を過ぎたら1回通知します。`);
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

  const calendarGroups = useMemo(() => groupCalendars(deviceCalendars || [], authUser?.email), [deviceCalendars, authUser?.email]);
  const selectedCalendar = (deviceCalendars || []).find((c) => c.id === selectedCalendarId);
  const activeGroupKey = calendarGroupFilter || (selectedCalendar ? calendarGroupKey(selectedCalendar) : calendarGroups[0]?.key || '');
  const activeGroup = calendarGroups.find((g) => g.key === activeGroupKey) || calendarGroups[0];

  /** 名前を入力してカレンダーを選ぶ（端末にあればそれを使う。なければ作り方を案内） */
  const handleApplyCalendarName = (listOverride?: DeviceCalendarInfo[] | null) => {
    const name = calendarNameInput.trim();
    if (!name) {
      setCalendarNameStatus({ kind: 'info', text: 'カレンダー名を入力してください。' });
      return;
    }
    const list = listOverride || deviceCalendars || [];
    const hit = findCalendarByName(list, name, activeGroup?.key);
    if (hit) {
      setSelectedCalendarId(hit.id);
      setCalendarGroupFilter(calendarGroupKey(hit));
      setCalendarNameStatus({
        kind: 'ok',
        text: `「${hit.displayName}」（${hit.accountName}）を登録先にしました。${hit.syncEvents === false ? '\nこのカレンダーは端末で同期がオフです。下の「同期をオンにする」を押してください。' : ''}`,
      });
    } else {
      setCalendarNameStatus({
        kind: 'notfound',
        text: `「${name}」というカレンダーはこの端末にありません。\nこのアプリから Google カレンダーに新しいカレンダーを作ることはできないため（Google の審査が必要な権限になるため）、次の手順で一度だけ作成してください。`,
      });
    }
  };

  const handleOpenCreateCalendar = async () => {
    try {
      if (Capacitor.isNativePlatform()) await Browser.open({ url: GOOGLE_CREATE_CALENDAR_URL });
      else window.open(GOOGLE_CREATE_CALENDAR_URL, '_blank', 'noopener');
    } catch {
      window.open(GOOGLE_CREATE_CALENDAR_URL, '_blank');
    }
  };

  /** 端末のカレンダーアカウントに同期を依頼して、一覧を読み直す */
  const handleRefreshCalendars = async () => {
    setIsRefreshingCalendars(true);
    try {
      const granted = await ensureCalendarPermission();
      if (!granted) {
        showCalendarPermissionGuide();
        return;
      }
      await refreshDeviceCalendars();
      // 同期が終わるまで少し待ってから読み直す（間に合わなければもう一度押す）
      await new Promise((r) => setTimeout(r, 4000));
      const list = await loadDeviceCalendars(false);
      if (list && calendarNameInput.trim()) handleApplyCalendarName(list);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'カレンダー一覧を再読込できませんでした。';
      setErrorDialog({ title: 'カレンダーの再読込エラー', message, detail: error instanceof CalendarError ? error.detail : errorDetail(error) });
    } finally {
      setIsRefreshingCalendars(false);
    }
  };

  const handleEnableCalendarSync = async () => {
    if (!selectedCalendar) return;
    try {
      await enableCalendarSync(selectedCalendar.id);
      await loadDeviceCalendars(false);
      showToast(`「${selectedCalendar.displayName}」の同期をオンにしました`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '同期をオンにできませんでした。';
      setErrorDialog({ title: 'カレンダーの同期設定エラー', message, detail: error instanceof CalendarError ? error.detail : errorDetail(error) });
    }
  };

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
      calendarTargets.slice(0, 8).map((t) => `・${eventDateOf(t).slice(5).replace('-', '/')} ${t.title}`).join('\n') +
      (calendarTargets.length > 8 ? `\n…ほか ${calendarTargets.length - 8} 件` : '') + '\n\n' +
      (target.syncEvents === false ? '⚠ このカレンダーは端末で「同期」がオフのため、Googleカレンダー（クラウド）には反映されません。\n\n' : '') +
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
      setExportHistory(loadExportHistory());
      const where = outcome.calendar
        ? `登録先: ${outcome.calendar.displayName || ''}（${outcome.calendar.accountName || ''}）`
        : `登録先: ${calLabel}`;
      const dates = (outcome.history?.items || []).filter((i) => i.ok).map((i) => `・${i.date.slice(5).replace('-', '/')} ${i.title}`).slice(0, 8).join('\n');
      if (r.failed) {
        setErrorDialog({ title: 'エクスポートの一部が失敗しました', message: summary, detail: (r.errors || []).join('\n') });
      } else {
        alert(`エクスポートが完了しました。\n${summary}\n${where}\n${dates}\n\n予定は「完了日」の日付に入っています。`);
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

  /** このアプリの形式の予定を全カレンダーから探す（読むだけ） */
  const handleFindAppEvents = async () => {
    if (!calendarPrefix.trim()) {
      alert('プレフィックスが空のため、このアプリの予定を見分けられません。プレフィックスを入力してから探してください。');
      return;
    }
    if (calendarPermission !== 'granted') {
      const list = await loadDeviceCalendars(true);
      if (!list) return;
    }
    setIsSearchingEvents(true);
    try {
      const events = await findAppEvents(calendarPrefix);
      setAppEvents(events);
      setAppEventSelection(new Set());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '予定の検索に失敗しました。';
      const detail = error instanceof CalendarError ? error.detail : errorDetail(error);
      setErrorDialog({ title: '予定の検索エラー', message, detail });
    } finally {
      setIsSearchingEvents(false);
    }
  };

  /** 一覧で選んだ予定だけを、確認のうえ削除する */
  const handleDeleteSelectedAppEvents = async () => {
    if (!appEvents || appEventSelection.size === 0) return;
    const chosen = appEvents.filter((e) => appEventSelection.has(e.eventId));
    const listText = chosen.slice(0, 15).map((e) => `・${e.date} ${e.title}（${e.calendarName}）`).join('\n');
    if (!window.confirm(`次の ${chosen.length} 件の予定をカレンダーから削除します。元に戻せません。\n\n${listText}${chosen.length > 15 ? `\n…ほか ${chosen.length - 15} 件` : ''}\n\nよろしいですか？`)) return;
    setIsSearchingEvents(true);
    try {
      const res = await deleteAppEvents(chosen.map((e) => e.eventId));
      alert(`${res.deleted} 件の予定を削除しました。${res.errors.length ? `\n失敗: ${res.errors.join(', ')}` : ''}\nタスク側の「カレンダー登録済」の印はそのままです。`);
      setAppEvents(await findAppEvents(calendarPrefix));
      setAppEventSelection(new Set());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '予定の削除に失敗しました。';
      const detail = error instanceof CalendarError ? error.detail : errorDetail(error);
      setErrorDialog({ title: '予定の削除エラー', message, detail });
    } finally {
      setIsSearchingEvents(false);
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
  /** その日（実施予定日）の、指定した重要度の緊急度の最大＋1（削除済みは除く） */
  const getNextNumberOnDate = (letter: PriorityLetter, date: string, extra: Task[] = []): number => {
    const nums = [...tasks, ...extra]
      .filter((t) => t.priorityLetter === letter && t.dueDate === date && t.status !== 'deleted')
      .map((t) => t.priorityNumber)
      .filter((n): n is number => typeof n === 'number' && !isNaN(n));
    return nums.length ? Math.max(...nums) + 1 : 1;
  };

  /**
   * 簡易登録の重要度・緊急度（v0.6.4〜）
   * 1. タスク内容に「B1」「Ｂ２」「a3」などが明示されていればそれを使う（既存と重複してもそのまま）
   * 2. なければ、重要度・緊急度のプルダウンで選んだ値
   * 3. どちらもなければ既定値: 重要度 B、緊急度はその日の B の最大＋1（登録するたびに B1, B2, B3…）
   */
  const resolveQuickPriority = (titleText: string, date: string = selectedDate): { letter: PriorityLetter; number: number | null; title: string; source: 'manual' | 'auto' | 'default' } => {
    const parsed = parsePriorityPrefix(titleText);
    const manual = quickLetter !== '' || quickNumber !== null;
    const title = parsed.matched && parsed.rest.trim() ? parsed.rest : titleText.trim();
    if (parsed.matched) {
      const number = parsed.letterOnly ? (parsed.letter ? getNextNumberOnDate(parsed.letter, date) : null) : parsed.number;
      return { letter: parsed.letter, number, title, source: 'auto' };
    }
    if (manual) {
      const number = quickNumber !== null ? quickNumber : (quickLetter ? getNextPriorityNumber(quickLetter) : null);
      return { letter: quickLetter, number, title, source: 'manual' };
    }
    return { letter: 'B', number: getNextNumberOnDate('B', date), title, source: 'default' };
  };

  // 一覧・簡易登録画面の追加アクション
  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickTitle.trim()) return;

    // 先に日付表現を抽出して取り除く
    const { dueDate: parsedDate, cleanedText: parsedTitle } = parseDueDateFromText(quickTitle);
    const resolved = resolveQuickPriority(parsedTitle.trim() || quickTitle.trim(), parsedDate || selectedDate);
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
      // 新規タスク: 設定の通知時刻を初期値にして通知ON（v0.6.5〜）
      reminderTime: getDailyNotifyTime(),
      reminderEnabled: true,
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

  // --- v0.6.0: 行内編集（日付・重要度/緊急度）とドラッグ＆ドロップ ---
  const handleSetDueDate = (taskId: string, date: string) => {
    if (!date) return;
    const target = tasks.find((t) => t.id === taskId);
    if (!target || target.dueDate === date) return;
    const now = new Date().toISOString();
    updateTasksState(tasks.map((t) => (t.id === taskId ? { ...t, dueDate: date, reminderNotified: false, updatedAt: now } : t)));
  };

  const handleSetPriority = (taskId: string, letter: PriorityLetter, number: number | null) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    const num = number;
    if (target.priorityLetter === letter && target.priorityNumber === num) return;
    const now = new Date().toISOString();
    updateTasksState(tasks.map((t) => (
      t.id === taskId ? { ...t, priorityLetter: letter, priorityNumber: num, quadrant: getTaskQuadrant(letter, num), updatedAt: now } : t
    )));
  };

  const handleMoveToQuadrant = (taskId: string, quadrant: TaskQuadrant) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    const next = priorityForQuadrant(target, quadrant, tasks);
    if (!next) return;
    const now = new Date().toISOString();
    updateTasksState(tasks.map((t) => (
      t.id === taskId
        ? { ...t, priorityLetter: next.letter, priorityNumber: next.number, quadrant: getTaskQuadrant(next.letter, next.number), updatedAt: now }
        : t
    )));
    const label = QUADRANT_CONFIGS.find((q) => q.id === quadrant)?.label || '';
    const prLabel = next.letter ? `${next.letter}${next.number ?? ''}` : next.number !== null ? `重要度なし・緊急度${next.number}` : '重要度・緊急度なし';
    showToast(`「${target.title}」を ${prLabel}（${label}）に変更しました`);
  };

  const drag = useTaskDrag((taskId: string, dropTarget: DropTarget) => {
    if (dropTarget.kind === 'date') {
      const t = tasks.find((x) => x.id === taskId);
      if (t && t.dueDate !== dropTarget.value) {
        handleSetDueDate(taskId, dropTarget.value);
        showToast(`「${t.title}」を ${fmtRangeDate(dropTarget.value)} に移動しました`);
      }
    } else {
      handleMoveToQuadrant(taskId, dropTarget.value as TaskQuadrant);
    }
  });

  const rowHandlers: TaskRowHandlers = {
    onStatus: (taskId, status) => handleUpdateTaskFieldDirect(taskId, 'status', status),
    onPriority: handleSetPriority,
    onDate: handleSetDueDate,
    onOpen: handleSelectTaskForDetail,
  };

  // 並べ替えは毎回の表示時に行うので、追加・編集したタスクも常に正しい位置に表示される
  const sortTaskList = (list: Task[]) => [...list].sort((a, b) => compareTasks(a, b, sortDir));

  // 達成状況の絞り込み（全タブ共通）
  const statusFilteredTasks = tasks.filter((t) => matchesStatusFilter(t, statusFilter));

  // --- Filter Tasks for Main List View ---
  const mainFilteredTasks = statusFilteredTasks.filter((task) => {
    const q = getTaskQuadrant(task.priorityLetter, task.priorityNumber);
    if (selectedQuadrant && q !== selectedQuadrant) return false;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchTitle = task.title.toLowerCase().includes(query);
      const matchNotes = task.notes?.toLowerCase().includes(query) || false;
      if (!matchTitle && !matchNotes) return false;
    }
    return true;
  });
  const sortedTasks = sortTaskList(mainFilteredTasks);

  // Calculate day-of-week string in Japanese
  const getJPDayOfWeek = (dateStr: string) => {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const d = parseLocalDate(dateStr);
    return weekdays[d.getDay()];
  };

  // Highlight today's date
  const todayStr = getLocalDateString();

  return (
    <div className="app-shell overflow-hidden flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-200" id="matrix-app-container">
      
      {/* Premium Top Line Accent */}
      <div className="h-1 bg-gradient-to-r from-emerald-500 via-zinc-800 to-amber-500 dark:from-emerald-400 dark:via-zinc-100 dark:to-amber-400" />

      {/* Header Bar */}
      <header className="border-b border-zinc-200/60 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md sticky top-0 z-30 flex-none" id="global-header">
        <div className="w-full px-3 sm:px-4 lg:px-6 py-2">
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
          className="modal-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setErrorDialog(null)}
          role="dialog"
          aria-modal="true"
          id="error-detail-dialog"
        >
          <div
            className="modal-card w-full max-w-md rounded-2xl p-5"
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
        className="w-full min-w-0 px-2 sm:px-4 lg:px-6 py-2 sm:py-3 flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col" 
        id="view-panel-viewport"
      >
        
        {/* VIEW 1: 一覧画面 */}
        {currentView === 'list' && (
          <div className="flex flex-col gap-3 animate-fade-in md:flex-1 md:min-h-0" id="view-list-container">
            <section className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col md:flex-1 md:min-h-0" id="main-list-table-panel">
              <div className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className="text-xs font-black tracking-wider uppercase text-zinc-400 dark:text-zinc-500 truncate">
                    <span className="sm:hidden">タスク</span>
                    <span className="hidden sm:inline">タスクプラン一覧</span>
                  </h3>
                  <span className="text-[0.8125rem] font-bold px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-zinc-500" id="list-count">
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
                  <input
                    type="text"
                    placeholder="キーワード検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="hidden md:inline-block px-2.5 h-8 text-[0.875rem] font-medium bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none w-40 lg:w-56 text-zinc-800 dark:text-zinc-200"
                  />
                  <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} className="max-w-[9.5rem] sm:max-w-none" />
                  {!isWide && <SortToggle dir={sortDir} onToggle={toggleSortDir} />}
                  <button
                    onClick={handleCreateNewTaskDetail}
                    className="flex shrink-0 px-2.5 h-8 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-lg text-[0.875rem] font-bold transition-all items-center gap-1 shadow-xs"
                    title="詳細を入力して作成"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">詳細作成</span>
                  </button>
                </div>
              </div>

              {isWide && <TaskRowHeader sortDir={sortDir} onToggleSort={toggleSortDir} />}
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60 md:flex-1 md:min-h-0 md:overflow-y-auto" id="list-rows">
                {sortedTasks.length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-400 dark:text-zinc-500">
                    <Inbox className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                    表示するタスクがありません。予定を追加するか、絞り込みを変更してください。
                  </div>
                ) : (
                  sortedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      dateMode={isWide ? 'full' : 'short'}
                      showNotes={isWide}
                      todayStr={todayStr}
                      handlers={rowHandlers}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        )}

        {/* VIEW: 4つの領域 (マトリクス) — タスクを別の領域へドラッグすると優先度が変わる */}
        {currentView === 'matrix' && (
          <div className="flex flex-col gap-3 animate-fade-in md:flex-1 md:min-h-0" id="view-matrix-container">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl px-3 py-2 sm:px-4 shadow-xs">
              <div className="min-w-0">
                <h3 className="text-xs font-black tracking-wider uppercase text-zinc-400 dark:text-zinc-500">時間管理マトリクス</h3>
                <p className="text-[0.8125rem] font-semibold text-zinc-600 dark:text-zinc-300">
                  タスクを別の領域へドラッグ＆ドロップすると、その領域になるよう重要度・緊急度が変わります{!isWide && '（長押ししてから動かす）'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} className="max-w-[11rem] sm:max-w-none" />
                <SortToggle dir={sortDir} onToggle={toggleSortDir} />
              </div>
            </div>

            {isWide ? (
              <section className="grid grid-cols-2 grid-rows-2 gap-3 flex-1 min-h-[32rem]" id="coovey-matrix-grid">
                {QUADRANT_CONFIGS.map((quad) => {
                  const qTasks = sortTaskList(statusFilteredTasks.filter((t) => getTaskQuadrant(t.priorityLetter, t.priorityNumber) === quad.id));
                  const isOver = drag.over?.kind === 'quadrant' && drag.over.value === quad.id;
                  return (
                    <div
                      key={quad.id}
                      data-drop-kind="quadrant"
                      data-drop-value={quad.id}
                      id={`matrix-zone-${quad.id}`}
                      className={`border-2 rounded-2xl flex flex-col min-h-0 transition-all ${quad.color} ${isOver ? 'ring-4 ring-sky-400 border-sky-400 scale-[1.01]' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-current/10">
                        <div className="min-w-0">
                          <span className="text-sm font-black">{quad.label}</span>
                          <span className="ml-2 text-[0.8125rem] font-bold opacity-80">{quad.desc}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-none">
                          <span className="text-[0.8125rem] font-black px-2 py-0.5 rounded-full bg-zinc-900/10 dark:bg-zinc-100/10 text-zinc-700 dark:text-zinc-300">{qTasks.length}件</span>
                          <button
                            onClick={() => setQuadrantPopup(quad)}
                            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-full hover:bg-zinc-500/10"
                            title={`${quad.label}の説明`}
                          >
                            <HelpCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-y-auto p-1 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/60 bg-white/80 dark:bg-zinc-950/40 rounded-b-2xl">
                        {qTasks.length === 0 ? (
                          <div className="text-[0.8125rem] text-zinc-400 italic text-center py-6">ここへドロップできます</div>
                        ) : (
                          qTasks.map((t) => (
                            <TaskRow
                              key={t.id}
                              task={t}
                              dateMode={isXL ? 'short' : 'icon'}
                              todayStr={todayStr}
                              handlers={rowHandlers}
                              dragProps={drag.bind(t.id, t.title)}
                              isDragging={drag.visual?.taskId === t.id}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            ) : (
              <>
                <section className="grid grid-cols-2 gap-2 sticky -top-2 z-30 bg-zinc-50 dark:bg-zinc-950 pt-2 pb-2 -mt-2 isolate" id="coovey-matrix-grid">
                  {QUADRANT_CONFIGS.map((quad) => {
                    const isFiltered = selectedQuadrant === quad.id;
                    const isOver = drag.over?.kind === 'quadrant' && drag.over.value === quad.id;
                    const count = statusFilteredTasks.filter((t) => getTaskQuadrant(t.priorityLetter, t.priorityNumber) === quad.id).length;
                    return (
                      <div
                        key={quad.id}
                        data-drop-kind="quadrant"
                        data-drop-value={quad.id}
                        id={`matrix-zone-${quad.id}`}
                        onClick={() => setSelectedQuadrant(isFiltered ? null : quad.id)}
                        className={`border-2 rounded-xl px-2.5 py-2 cursor-pointer transition-all bg-white dark:bg-zinc-900 ${quad.color} ${
                          isFiltered ? 'ring-2 ring-offset-1 dark:ring-offset-zinc-950' : ''
                        } ${isOver ? 'ring-4 ring-sky-400 border-sky-400 scale-[1.03]' : ''} flex items-center justify-between gap-1 min-h-[52px]`}
                      >
                        <span className="text-[0.875rem] font-black leading-tight break-words">{quad.label}</span>
                        <span className="flex items-center gap-1 flex-none">
                          <span className="text-[0.75rem] font-black px-1.5 py-0.5 rounded-full bg-zinc-900/10 dark:bg-zinc-100/10 text-zinc-700 dark:text-zinc-300">{count}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuadrantPopup(quad);
                            }}
                            className="p-0.5 text-zinc-400 rounded-full"
                            title={`${quad.label}の説明`}
                          >
                            <HelpCircle className="w-4 h-4" />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </section>
                <section className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-2 shadow-xs">
                  <div className="flex items-center gap-2 px-1 pb-1.5">
                    <h3 className="text-xs font-black tracking-wider text-zinc-400 dark:text-zinc-500">
                      {selectedQuadrant ? `第${selectedQuadrant}領域のタスク` : 'すべての領域のタスク'}
                    </h3>
                    {selectedQuadrant && (
                      <button onClick={() => setSelectedQuadrant(null)} className="text-[0.8125rem] font-bold text-amber-600 dark:text-amber-400 underline">
                        選択解除
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/60">
                    {(() => {
                      const list = sortTaskList(
                        statusFilteredTasks.filter((t) => !selectedQuadrant || getTaskQuadrant(t.priorityLetter, t.priorityNumber) === selectedQuadrant)
                      );
                      if (list.length === 0) {
                        return (
                          <div className="py-10 text-center text-xs text-zinc-400 dark:text-zinc-500">
                            <Inbox className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                            該当するタスクがありません。
                          </div>
                        );
                      }
                      return list.map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          dateMode="short"
                          todayStr={todayStr}
                          handlers={rowHandlers}
                          dragProps={drag.bind(t.id, t.title)}
                          isDragging={drag.visual?.taskId === t.id}
                        />
                      ));
                    })()}
                  </div>
                </section>
              </>
            )}

            {quadrantPopup && (
              <div
                className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
                id="quadrant-popup-modal"
                onClick={() => setQuadrantPopup(null)}
              >
                <div
                  className="modal-card rounded-2xl max-w-sm w-full p-5 relative"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="text-[0.8125rem] font-black tracking-wider text-zinc-400 dark:text-zinc-500">領域の説明</span>
                      <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100 mt-0.5">{quadrantPopup.label}</h3>
                    </div>
                    <button onClick={() => setQuadrantPopup(null)} className="p-1 rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-950 rounded-lg border border-zinc-100 dark:border-zinc-800">
                      <span className="text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 mr-1.5">性質:</span>
                      <span className="text-xs font-black text-zinc-700 dark:text-zinc-300">{quadrantPopup.desc}</span>
                    </div>
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 leading-relaxed">{quadrantPopup.sub}</p>
                    <p className="text-[0.8125rem] font-semibold text-zinc-500 dark:text-zinc-400 leading-relaxed">ドロップしたとき: {quadrantPopup.drop}</p>
                  </div>
                  <div className="mt-5 flex justify-end">
                    <button onClick={() => setQuadrantPopup(null)} className="px-3 py-1.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-black rounded-lg">
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: デイリータスク画面 (7日間。タスクを別の日へドラッグ＆ドロップで実施予定日を変更) */}
        {currentView === 'daily' && (
          <div className="flex flex-col gap-3 animate-fade-in md:flex-1 md:min-h-0" id="view-daily-weekly-container">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl px-3 py-2 sm:px-4 shadow-xs">
              <div className="flex items-center justify-between md:justify-start gap-3 min-w-0">
                <h3 className="text-xs font-black tracking-wider text-zinc-400 dark:text-zinc-500 whitespace-nowrap truncate"><span className="hidden sm:inline">7日間の</span>デイリープランナー</h3>
                <button
                  type="button"
                  onClick={() => setShowDailyHelp(true)}
                  className="inline-flex items-center gap-1 text-[0.8125rem] font-bold text-sky-600 dark:text-sky-400 hover:underline whitespace-nowrap"
                  id="btn-daily-help"
                >
                  <HelpCircle className="w-4 h-4" />
                  週プランナーの使い方
                </button>
              </div>

              <div className="flex items-center justify-center gap-1.5 sm:gap-2" id="week-range-nav">
                <button
                  onClick={() => handleShiftWeek(-1)}
                  className="p-1 sm:p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                  title="7日前"
                  aria-label="7日前"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="font-black tracking-tight whitespace-nowrap text-zinc-900 dark:text-zinc-50 text-lg sm:text-2xl xl:text-3xl px-0.5 sm:px-2" id="week-range-label">
                  {fmtRangeDate(weekDays[0])}
                  <span className="mx-1.5 text-zinc-400">〜</span>
                  {fmtRangeDate(weekDays[6])}
                </span>
                <button
                  onClick={() => handleShiftWeek(1)}
                  className="p-1 sm:p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                  title="7日後"
                  aria-label="7日後"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setSelectedDate(getLocalDateString())}
                  className="px-2 sm:px-3 py-1 sm:py-1.5 text-[0.875rem] font-bold whitespace-nowrap rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                >
                  今日
                </button>
              </div>

              <div className="flex items-center justify-end gap-1.5">
                <StatusFilterSelect value={statusFilter} onChange={setStatusFilter} className="max-w-[11rem] sm:max-w-none" />
                <SortToggle dir={sortDir} onToggle={toggleSortDir} />
              </div>
            </div>

            <div className={`grid grid-cols-1 gap-2 md:flex-1 md:min-h-[24rem] ${isXL ? 'md:grid-cols-7 md:grid-rows-1' : 'md:grid-cols-4 md:grid-rows-2'}`} id="weekly-days-grid" data-density={isXL ? dailyDensity : 'normal'}>
              {weekDays.map((dateStr) => {
                const isToday = dateStr === todayStr;
                const jpDay = getJPDayOfWeek(dateStr);
                const isWeekend = jpDay === '土' || jpDay === '日';
                const allDayTasks = tasks.filter((t) => t.dueDate === dateStr && t.status !== 'deleted');
                const dayTasks = sortTaskList(statusFilteredTasks.filter((t) => t.dueDate === dateStr));
                const completedCount = allDayTasks.filter((t) => t.status === 'completed').length;
                const progressPct = allDayTasks.length > 0 ? Math.round((completedCount / allDayTasks.length) * 100) : 0;
                const isOver = drag.over?.kind === 'date' && drag.over.value === dateStr;
                // v0.6.8: 完了タスクの折りたたみ（PC・タブレット幅のみ。スマホは今まで通りすべて表示）
                const collapseDone = isWide && dailyCollapseDone && statusFilter !== 'completed';
                const doneTasks = collapseDone ? dayTasks.filter((t) => t.status === 'completed') : [];
                const shownTasks = collapseDone ? dayTasks.filter((t) => t.status !== 'completed') : dayTasks;
                const doneExpanded = expandedDoneDays.has(dateStr);
                const rowDensity = isXL ? dailyDensity : undefined;
                const renderRow = (t: Task) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    dateMode="short"
                    density={rowDensity}
                    todayStr={todayStr}
                    handlers={rowHandlers}
                    dragProps={drag.bind(t.id, t.title)}
                    isDragging={drag.visual?.taskId === t.id}
                  />
                );

                return (
                  <div
                    key={dateStr}
                    data-drop-kind="date"
                    data-drop-value={dateStr}
                    id={`day-col-${dateStr}`}
                    className={`border-2 rounded-xl p-1.5 flex flex-col min-w-0 md:min-h-0 transition-all bg-white dark:bg-zinc-900/90 ${
                      isOver
                        ? 'border-sky-400 ring-4 ring-sky-400/40 bg-sky-50 dark:bg-sky-950/30'
                        : isToday
                        ? 'border-zinc-900 dark:border-zinc-100'
                        : isWeekend
                        ? 'border-zinc-200/60 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-900/30'
                        : 'border-zinc-200/60 dark:border-zinc-800/80'
                    }`}
                  >
                    <div className="border-b border-zinc-100 dark:border-zinc-800 pb-1 mb-1.5 px-1">
                      <div className="flex justify-between items-baseline gap-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="text-base font-black text-zinc-800 dark:text-zinc-100">{Number(dateStr.slice(5, 7))}/{Number(dateStr.slice(8, 10))}</span>
                          <span className={`text-sm font-black ${jpDay === '日' ? 'text-red-500' : jpDay === '土' ? 'text-blue-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
                            ({jpDay})
                          </span>
                        </span>
                        <span className="flex items-center gap-1 flex-none">
                          {isToday && (
                            <span className="text-[0.75rem] font-black bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 px-1.5 py-0.5 rounded-md whitespace-nowrap">本日</span>
                          )}
                        </span>
                      </div>
                      {allDayTasks.length > 0 && (
                        <div className="mt-1 flex items-center justify-between gap-1">
                          <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 h-1 rounded-full overflow-hidden">
                            <div className="bg-zinc-900 dark:bg-zinc-100 h-full transition-all" style={{ width: `${progressPct}%` }} />
                          </div>
                          <span
                            className="text-[0.75rem] font-black px-1 rounded bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 whitespace-nowrap"
                            id={`day-count-${dateStr}`}
                            title={`この日のタスク ${allDayTasks.length}件（未完了 ${allDayTasks.length - completedCount}件）`}
                          >
                            {allDayTasks.length}件・未完了{allDayTasks.length - completedCount}
                          </span>
                          <span className="text-[0.75rem] font-bold text-zinc-400 font-mono">{progressPct}%</span>
                        </div>
                      )}
                    </div>

                    <DayTaskScroll className="flex-1 md:min-h-0 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/60 md:overflow-y-auto" id={`day-list-${dateStr}`}>
                      {dayTasks.length === 0 ? (
                        <div className="text-[0.8125rem] text-zinc-400/80 dark:text-zinc-600 italic text-center py-3 md:py-6">
                          {isOver ? 'ここへ移動' : '予定なし'}
                        </div>
                      ) : (
                        <>
                          {shownTasks.map(renderRow)}
                          {doneTasks.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleDoneDay(dateStr)}
                              className="w-full py-1 text-center text-[0.75rem] font-bold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded-md"
                              id={`btn-done-toggle-${dateStr}`}
                              aria-expanded={doneExpanded}
                            >
                              ✓ 完了 {doneTasks.length}件（{doneExpanded ? 'クリックで隠す' : 'クリックで表示'}）
                            </button>
                          )}
                          {doneExpanded && doneTasks.map(renderRow)}
                        </>
                      )}
                    </DayTaskScroll>

                    <div className="pt-1.5 mt-1.5 border-t border-zinc-100 dark:border-zinc-800/60">
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

            {showDailyHelp && (
              <div
                className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
                id="daily-help-modal"
                onClick={() => setShowDailyHelp(false)}
              >
                <div
                  className="modal-card rounded-2xl max-w-lg w-full p-5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-base font-black text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <HelpCircle className="w-5 h-5 text-sky-500" />
                      週プランナーの使い方
                    </h3>
                    <button onClick={() => setShowDailyHelp(false)} className="p-1 rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="閉じる">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <ul className="list-disc pl-5 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed font-medium">
                    <li>選んだ日から始まる7日間を並べ、各日に実施予定日が入っているタスクを表示します。◀ ▶ で1週間ずつ移動、「今日」で今日からの7日間に戻ります。</li>
                    <li>タスクを別の日へドラッグ＆ドロップすると、実施予定日がその日に変わります（スマホは少し長押ししてから動かします）。</li>
                    <li>達成状況・重要度・緊急度はプルダウンでその場で変更できます。日付を押すとカレンダーが開き、日付を変更できます。</li>
                    <li>タスク名を押すと詳細画面が開きます。「予定を作成」でその日の予定を詳細入力で作れます。</li>
                    <li>上の「達成状況」の絞り込みと「期日」の並べ替え（押すたびに昇順・降順）は、ほかのタブと共通です。</li>
                    <li>パソコンの広い画面では7日を横1列に並べ、タスクを詰めて表示します（日付ボタンは出ないので、日付はドラッグか詳細で変更）。各日の「N件・未完了M」が件数、「▼ スクロールで あとN件」が出たらカードの中をスクロールできます。完了したタスクは「✓ 完了 N件」を押すと表示されます。表示密度と折りたたみは設定で変えられます。</li>
                  </ul>
                  <div className="mt-5 flex justify-end">
                    <button onClick={() => setShowDailyHelp(false)} className="px-4 py-2 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-black rounded-lg">
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW: 設定画面 (すべての画面上部から移動された通知許可〜読み込み設定) */}
        {currentView === 'settings' && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl p-4 sm:p-6 shadow-xs max-w-2xl w-full mx-auto animate-fade-in" id="view-settings-container">
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
                    <div className="flex flex-col gap-2" id="calendar-picker">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[0.75rem] font-bold text-zinc-500 dark:text-zinc-400 mb-0.5" htmlFor="calendar-group-select">カレンダーの種類（アカウント）</label>
                          <select
                            id="calendar-group-select"
                            value={activeGroup?.key || ''}
                            onChange={(e) => {
                              const g = calendarGroups.find((x) => x.key === e.target.value);
                              setCalendarGroupFilter(e.target.value);
                              if (g && !g.calendars.some((c) => c.id === selectedCalendarId)) {
                                const def = g.calendars.find((c) => c.isPrimary && c.syncEvents !== false) || g.calendars.find((c) => c.syncEvents !== false) || g.calendars[0];
                                if (def) setSelectedCalendarId(def.id);
                              }
                            }}
                            className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none font-semibold"
                          >
                            {(['google', 'local', 'other'] as const).map((kind) => {
                              const groups = calendarGroups.filter((g) => g.kind === kind);
                              if (groups.length === 0) return null;
                              return (
                                <optgroup key={kind} label={kind === 'google' ? 'Google アカウント（Googleカレンダーと同期）' : kind === 'local' ? '端末内（同期しない）' : 'その他のアカウント'}>
                                  {groups.map((g) => (
                                    <option key={g.key} value={g.key}>{g.label}・{g.calendars.length}件</option>
                                  ))}
                                </optgroup>
                              );
                            })}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[0.75rem] font-bold text-zinc-500 dark:text-zinc-400 mb-0.5" htmlFor="calendar-select">カレンダー</label>
                          <select
                            id="calendar-select"
                            value={activeGroup?.calendars.some((c) => c.id === selectedCalendarId) ? selectedCalendarId : ''}
                            onChange={(e) => {
                              setSelectedCalendarId(e.target.value);
                              setCalendarNameStatus(null);
                            }}
                            className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none font-semibold"
                          >
                            {!activeGroup?.calendars.some((c) => c.id === selectedCalendarId) && <option value="" disabled>選んでください</option>}
                            {(activeGroup?.calendars || []).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.displayName}{c.isPrimary ? ' ★' : ''}{c.syncEvents === false ? '（同期オフ）' : ''}{c.visible === false ? '（非表示）' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {selectedCalendar && (
                        <div className="text-[0.8125rem] font-semibold text-zinc-600 dark:text-zinc-300 break-all" id="calendar-selected-label">
                          登録先: {selectedCalendar.displayName}（{selectedCalendar.accountType === 'LOCAL' ? '端末内・同期なし' : `${selectedCalendar.accountType === 'com.google' ? 'Google' : selectedCalendar.accountType}${selectedCalendar.accountName !== selectedCalendar.displayName ? `・${selectedCalendar.accountName}` : ''}`}）
                          {selectedCalendar.syncEvents === false && selectedCalendar.accountType !== 'LOCAL' && (
                            <span className="block mt-1 text-amber-700 dark:text-amber-400">
                              このカレンダーは端末で同期がオフのため、Googleカレンダーに反映されません。
                              <button type="button" onClick={() => void handleEnableCalendarSync()} className="ml-1 underline font-bold" id="btn-enable-calendar-sync">同期をオンにする</button>
                            </span>
                          )}
                        </div>
                      )}
                      <div>
                        <label className="block text-[0.75rem] font-bold text-zinc-500 dark:text-zinc-400 mb-0.5" htmlFor="calendar-name-input">カレンダー名を入力して選ぶ</label>
                        <div className="flex gap-2">
                          <input
                            id="calendar-name-input"
                            type="text"
                            list="calendar-name-options"
                            value={calendarNameInput}
                            onChange={(e) => {
                              setCalendarNameInput(e.target.value);
                              setCalendarNameStatus(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleApplyCalendarName();
                            }}
                            placeholder="例: ToDo完了"
                            maxLength={60}
                            className="flex-1 min-w-0 px-3 py-2 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl focus:outline-none font-semibold"
                          />
                          <datalist id="calendar-name-options">
                            {[...new Set(deviceCalendars.map((c) => c.displayName))].map((n) => <option key={n} value={n} />)}
                          </datalist>
                          <button type="button" onClick={() => handleApplyCalendarName()} className="px-3 py-2 rounded-xl text-xs font-bold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 flex-none" id="btn-apply-calendar-name">
                            この名前で選ぶ
                          </button>
                        </div>
                        {calendarNameStatus && (
                          <div
                            className={`mt-2 p-3 rounded-xl text-[0.8125rem] font-semibold whitespace-pre-line ${calendarNameStatus.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : calendarNameStatus.kind === 'notfound' ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border border-amber-300 dark:border-amber-700' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'}`}
                            id="calendar-name-status"
                          >
                            {calendarNameStatus.text}
                            {calendarNameStatus.kind === 'notfound' && (
                              <>
                                <ol className="list-decimal ml-5 mt-2 space-y-0.5">
                                  <li>下の「Googleカレンダーで作成」を押す（ブラウザで Google カレンダーの「新しいカレンダーを作成」が開きます）</li>
                                  <li>登録先にしたい Google アカウント（例: {authUser?.email || 'ご自分のGmail'}）でログインしていることを確認（右上のアイコン）</li>
                                  <li>「名前」に「{calendarNameInput.trim()}」と入力し、「カレンダーを作成」を押す</li>
                                  <li>このアプリに戻り「カレンダー一覧を再読込」を押す（出てこなければ1分ほど待ってもう一度）</li>
                                  <li>一覧に出たら、もう一度「この名前で選ぶ」を押す（同期オフと出たら「同期をオンにする」を押す）</li>
                                </ol>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  <button type="button" onClick={() => void handleOpenCreateCalendar()} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white" id="btn-open-create-calendar">Googleカレンダーで作成</button>
                                  <button type="button" onClick={() => void handleRefreshCalendars()} disabled={isRefreshingCalendars} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-zinc-400 dark:border-zinc-500 disabled:opacity-50" id="btn-refresh-calendars-inline">{isRefreshingCalendars ? '再読込中…' : 'カレンダー一覧を再読込'}</button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <button type="button" onClick={() => void handleRefreshCalendars()} disabled={isRefreshingCalendars} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 disabled:opacity-50" id="btn-refresh-calendars">
                          {isRefreshingCalendars ? '再読込中…' : 'カレンダー一覧を再読込'}
                        </button>
                      </div>
                    </div>
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
                    placeholder="例: ［ToDo］"
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

                {/* エクスポート履歴（どのカレンダーの何日に入れたか） */}
                <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2" id="calendar-export-history">
                  <summary className="text-xs font-bold text-zinc-600 dark:text-zinc-300 cursor-pointer">エクスポート履歴（直近5回）</summary>
                  {exportHistory.length === 0 ? (
                    <div className="mt-2 text-[0.8125rem] text-zinc-500">まだ記録はありません（v0.6.1 以降のエクスポートから記録します）。</div>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-2">
                      {exportHistory.map((h) => (
                        <li key={h.at} className="text-[0.8125rem] text-zinc-600 dark:text-zinc-300">
                          <div className="font-bold">
                            {new Date(h.at).toLocaleString('ja-JP')}・登録 {h.created} 件{h.failed ? `・失敗 ${h.failed} 件` : ''}
                          </div>
                          <div>カレンダー: {h.calendar.displayName || h.calendar.id}{h.calendar.accountName ? `（${h.calendar.accountName}）` : ''}{h.calendar.syncEvents === false ? '・同期オフ' : ''}{h.calendar.visible === false ? '・非表示' : ''}</div>
                          <ul className="pl-3">
                            {h.items.map((it, i) => (
                              <li key={i} className={it.ok ? '' : 'text-amber-700 dark:text-amber-400'}>
                                {it.ok ? '✓' : '⚠'} {it.date} {it.title}{it.note ? `（${it.note}）` : ''}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>

                {/* このアプリが登録した予定を探す・選んで削除（自動では何も消さない） */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 flex flex-col gap-2" id="calendar-app-events">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleFindAppEvents()}
                      disabled={isSearchingEvents}
                      className="px-3 py-1.5 border border-zinc-300 dark:border-zinc-700 rounded-lg text-xs font-bold text-zinc-700 dark:text-zinc-200 disabled:opacity-60"
                      id="btn-find-app-events"
                    >
                      {isSearchingEvents ? '確認中…' : 'このアプリが登録した予定を探す'}
                    </button>
                    <span className="text-[0.75rem] text-zinc-500">すべてのカレンダーから、予定名が「{calendarPrefix || '（プレフィックス）'}」で始まる終日予定を探します（見るだけ）</span>
                  </div>
                  {appEvents && (
                    appEvents.length === 0 ? (
                      <div className="text-[0.8125rem] text-zinc-500">見つかりませんでした。</div>
                    ) : (
                      <>
                        <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto">
                          {appEvents.map((e) => (
                            <li key={e.eventId} className="flex items-start gap-2 text-[0.8125rem]">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={appEventSelection.has(e.eventId)}
                                onChange={(ev) => {
                                  const next = new Set(appEventSelection);
                                  if (ev.target.checked) next.add(e.eventId);
                                  else next.delete(e.eventId);
                                  setAppEventSelection(next);
                                }}
                              />
                              <span className="min-w-0">
                                <span className="font-bold">{e.date}</span> {e.title}
                                <span className="block text-[0.75rem] text-zinc-500">
                                  {e.calendarName}（{e.accountName}）・{e.synced ? (e.dirty ? '変更をGoogleへ送信待ち' : 'Googleと同期済み') : 'まだGoogleに送られていない'}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setAppEventSelection(new Set(appEvents.map((e) => e.eventId)))}
                            disabled={appEventSelection.size === appEvents.length}
                            id="btn-select-all-app-events"
                            className="px-2 py-1 text-[0.75rem] font-bold border border-zinc-300 dark:border-zinc-700 rounded-lg disabled:opacity-40"
                          >
                            すべて選ぶ
                          </button>
                          <button
                            type="button"
                            onClick={() => setAppEventSelection(new Set())}
                            disabled={appEventSelection.size === 0}
                            className="px-2 py-1 text-[0.75rem] font-bold border border-zinc-300 dark:border-zinc-700 rounded-lg disabled:opacity-40"
                            id="btn-deselect-app-events"
                          >
                            すべて外す
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSelectedAppEvents()}
                            disabled={appEventSelection.size === 0 || isSearchingEvents}
                            className="px-3 py-1 text-[0.75rem] font-bold rounded-lg bg-red-600 text-white disabled:opacity-40"
                            id="btn-delete-app-events"
                          >
                            選んだ {appEventSelection.size} 件を削除
                          </button>
                        </div>
                      </>
                    )
                  )}
                </div>
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

            {/* Daily view setting（7日間の表示 v0.6.8） */}
            <div className="mb-6" id="settings-daily-view">
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                デイリー（7日間）の表示
              </h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200">表示密度</span>
                  <div className="inline-flex self-start sm:self-auto p-0.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" role="group" aria-label="表示密度">
                    <button
                      type="button"
                      id="daily-density-one"
                      onClick={() => changeDailyDensity('one')}
                      aria-pressed={dailyDensity === 'one'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${dailyDensity === 'one' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'}`}
                    >
                      1行に詰める
                    </button>
                    <button
                      type="button"
                      id="daily-density-two"
                      onClick={() => changeDailyDensity('two')}
                      aria-pressed={dailyDensity === 'two'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${dailyDensity === 'two' ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs' : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800'}`}
                    >
                      2行まで表示
                    </button>
                  </div>
                </div>
                <p className="text-[0.875rem] text-zinc-500 dark:text-zinc-400 leading-normal font-semibold">
                  パソコンの広い画面（横1280px以上）では7日を横1列に並べ、タスクを詰めて表示します。「1行に詰める」は長いタスク名を「…」で省略（マウスを乗せると全文）、「2行まで表示」は2行まで折り返します。この表示では日付ボタンを出さないので、日付はドラッグか詳細画面で変えてください。スマホ・狭い画面は今まで通りです。
                </p>
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-zinc-200/60 dark:border-zinc-800">
                  <label htmlFor="daily-collapse-done-toggle" className="text-sm font-bold text-zinc-700 dark:text-zinc-200 cursor-pointer">
                    完了したタスクを折りたたむ
                  </label>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      id="daily-collapse-done-toggle"
                      checked={dailyCollapseDone}
                      onChange={(e) => changeDailyCollapseDone(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-300 dark:bg-zinc-700 rounded-full peer peer-checked:bg-emerald-600 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                    <span className="ml-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 w-6">{dailyCollapseDone ? 'ON' : 'OFF'}</span>
                  </label>
                </div>
                <p className="text-[0.875rem] text-zinc-500 dark:text-zinc-400 leading-normal font-semibold">
                  ONのときは、各日のカードで完了したタスクを「✓ 完了 N件」の1行にまとめ、クリックで表示します（パソコン・タブレット幅のデイリー。スマホは今まで通りすべて表示します。絞り込みで「完了」を選んだときは折りたたみません）。
                </p>
              </div>
            </div>

            {/* Notification setting（毎日の通知 v0.6.3） */}
            <div className="mb-6" id="settings-notify">
              <h3 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 mb-2.5 uppercase tracking-wider">
                通知設定
              </h3>
              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-150 dark:border-zinc-850 rounded-xl flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="daily-notify-toggle" className="flex items-center gap-1.5 cursor-pointer">
                    <span className={`w-2 h-2 rounded-full ${dailyNotifyOn && notificationsGranted ? 'bg-emerald-500' : dailyNotifyOn ? 'bg-amber-500' : 'bg-zinc-400'}`} />
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200">プッシュ通知</span>
                  </label>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      id="daily-notify-toggle"
                      checked={dailyNotifyOn}
                      onChange={(e) => void applyDailyNotify(e.target.checked, dailyNotifyTime)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-zinc-300 dark:bg-zinc-700 rounded-full peer peer-checked:bg-emerald-600 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                    <span className="ml-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 w-6">{dailyNotifyOn ? 'ON' : 'OFF'}</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="daily-notify-time" className="text-[0.875rem] font-bold text-zinc-600 dark:text-zinc-300">通知する時刻（新規タスクの初期値）</label>
                  <input
                    type="time"
                    id="daily-notify-time"
                    value={dailyNotifyTime}
                    disabled={!dailyNotifyOn}
                    onChange={(e) => {
                      if (/^\d{2}:\d{2}$/.test(e.target.value)) void applyDailyNotify(dailyNotifyOn, e.target.value);
                    }}
                    className="px-3 py-1.5 text-sm font-bold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg disabled:opacity-50"
                  />
                </div>
                <p className="text-[0.8125rem] text-zinc-500 dark:text-zinc-400 leading-normal font-semibold">
                  毎日この時刻に、今日が実施予定日のタスクと期限切れの未完了タスクの件数・上位のタスクをまとめて通知します（対象がない日は通知しません）。
                  新規タスクにはこの時刻が通知時刻の初期値として設定されます（既存タスクは変更しません）。タスクごとの時刻は詳細画面で変えられ、その時刻に実施予定日に通知します。同じ時刻のタスクは1つの通知にまとめ、この時刻と同じものは上のまとめ通知に含めます。完了したタスクは通知しません。このスイッチをOFFにすると、すべての通知が止まります。
                  {Capacitor.isNativePlatform()
                    ? '端末の電池節約のため、数分遅れて届くことがあります。'
                    : 'Web版は、このページを開いている間だけ通知します（閉じているときは届きません）。'}
                </p>
                <div className="text-[0.8125rem] font-semibold text-zinc-600 dark:text-zinc-300 break-all" id="daily-notify-preview">
                  {(() => {
                    const s = buildDailySummary(tasks, getLocalDateString());
                    return s ? `今日の通知の例: ${s.title}（${s.body.split('\n')[0].replace(/^・/, '')}${s.body.includes('\n') ? ' など' : ''}）` : '今日の通知の例: 対象のタスクはありません（通知しません）';
                  })()}
                </div>
                {dailyNotifyOn && !notificationsGranted && !dailyNotifyInfo && (
                  <button
                    type="button"
                    onClick={() => void applyDailyNotify(true, dailyNotifyTime)}
                    className="self-start px-3 py-1.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 rounded-lg text-xs font-bold"
                    id="btn-notify-permission"
                  >
                    通知を許可する
                  </button>
                )}
                {dailyNotifyInfo && (
                  <div className="p-2.5 rounded-lg text-sm font-semibold whitespace-pre-line bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200" id="daily-notify-info">
                    {dailyNotifyInfo}
                  </div>
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
                  追加のバックアップとして、JSON / CSV の書き出し・読み込みが使えます（Android アプリは1日1回、端末に自動バックアップもします）。
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
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-800 rounded-2xl px-4 pt-4 sm:px-6 sm:pt-6 shadow-xs max-w-2xl w-full mx-auto animate-fade-in" id="view-detail-container">
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
        <div className="app-bottom w-full flex-none flex flex-col-reverse sm:flex-col lg:flex-row lg:items-start gap-2 sm:gap-3 lg:gap-6 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-zinc-200/80 dark:border-zinc-800/80 px-3 pt-2 sm:px-4 lg:px-6 sm:pt-3" id="bottom-controls-section">
          
          {/* Tab switching buttons */}
          <div className="w-full lg:w-[24rem] lg:flex-none lg:pt-6">
            <div className="flex bg-zinc-100 dark:bg-zinc-800/60 p-1 rounded-xl max-w-lg mx-auto lg:mx-0 gap-1" id="bottom-navigation-tabs">
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
            <section className="bg-transparent p-0 w-full lg:flex-1 min-w-0" id="quick-register-panel">
              
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
                const pd = parseDueDateFromText(quickTitle);
                const r = resolveQuickPriority(pd.cleanedText.trim() || quickTitle.trim(), pd.dueDate || selectedDate);
                const q = getTaskQuadrant(r.letter, r.number);
                const qLabel = q === 'I' ? '第Ⅰ領域（必須）' : q === 'II' ? '第Ⅱ領域（自己投資）' : q === 'III' ? '第Ⅲ領域（錯覚）' : '第Ⅳ領域（無駄）';
                const pr = `${r.letter}${r.number ?? ''}` || 'なし';
                if (!quickTitle.trim() && r.source !== 'manual') {
                  return (
                    <div className="hidden sm:flex mt-2 items-center gap-1 text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                      <span>重要度・緊急度はタスク内容の「A3」「Ｂ２」などが優先。なければプルダウン、どちらもなければ B とその日の次の番号</span>
                    </div>
                  );
                }
                return (
                  <div className="mt-1.5 sm:mt-2 flex items-center gap-1 text-[0.75rem] sm:text-[0.8125rem] font-bold text-zinc-500 dark:text-zinc-400 truncate" id="quick-priority-hint">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500 flex-none" />
                    <span className="truncate">
                      {r.source === 'manual' ? '選択' : r.source === 'auto' ? 'タスク内容の指定' : '既定（B＋その日の次の番号）'}: {pr}・{qLabel}
                      {r.source === 'auto' && (quickLetter !== '' || quickNumber !== null) ? '（プルダウンより優先）' : ''}
                    </span>
                  </div>
                );
              })()}

            </section>
          )}

        </div>
      )}

      {/* ドラッグ中の表示と、変更結果の通知 */}
      <DragGhost visual={drag.visual} />
      {toast && (
        <div className="pointer-events-none fixed left-1/2 -translate-x-1/2 bottom-40 lg:bottom-28 z-[150] px-4 py-2.5 rounded-xl bg-zinc-900/95 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-bold shadow-xl max-w-[92vw]" id="app-toast" role="status">
          {toast}
        </div>
      )}

    </div>
  );
}
