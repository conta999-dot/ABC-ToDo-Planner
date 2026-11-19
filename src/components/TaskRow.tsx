/**
 * すべてのタブで共通のタスク行（v0.6.0）
 * - 達成状況・重要度・緊急度はプルダウンでその場で変更
 * - タスク内容をタップ／クリックすると詳細画面へ
 * - 日付をタップ／クリックするとカレンダー（日付選択）が開く
 */
import React, { useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Bell, CalendarDays, CalendarCheck } from 'lucide-react';
import { PriorityLetter, Task, TaskStatus } from '../types';

export type SortDir = 'asc' | 'desc';

export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all_active', label: 'すべてのタスク (削除除く)' },
  { value: 'pending_or_progress', label: '未達成・進行中' },
  { value: 'pending', label: '未達成' },
  { value: 'in_progress', label: '進行中' },
  { value: 'completed', label: '完了' },
  { value: 'postponed', label: '先送り' },
  { value: 'delegated', label: '委任' },
  { value: 'deleted', label: '削除' },
  { value: 'all', label: 'すべて (削除含む)' },
];

export const matchesStatusFilter = (task: Task, filter: string): boolean => {
  if (filter === 'all_active') return task.status !== 'deleted';
  if (filter === 'pending_or_progress') return task.status === 'pending' || task.status === 'in_progress';
  if (filter === 'all') return true;
  return task.status === filter;
};

/** 期日（dir に従う。期日なしは常に最後）→ 同じ日の中は常に 重要度 A→B→C→なし → 緊急度 1,2,3… → タイトル（v0.6.0） */
export const compareTasks = (a: Task, b: Task, dir: SortDir): number => {
  const aEmpty = !a.dueDate;
  const bEmpty = !b.dueDate;
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  const sign = dir === 'asc' ? 1 : -1;
  if (a.dueDate !== b.dueDate) return sign * a.dueDate.localeCompare(b.dueDate);
  const w: Record<string, number> = { A: 10, B: 5, C: 2, '': 0 };
  const wa = w[a.priorityLetter || ''] || 0;
  const wb = w[b.priorityLetter || ''] || 0;
  if (wa !== wb) return wb - wa;
  const na = a.priorityNumber === null ? 999 : a.priorityNumber;
  const nb = b.priorityNumber === null ? 999 : b.priorityNumber;
  if (na !== nb) return na - nb;
  return (a.title || '').localeCompare(b.title || '');
};

const STATUS_STYLE: Record<TaskStatus, string> = {
  pending: 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700',
  in_progress: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800',
  completed: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
  postponed: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-800',
  delegated: 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
  deleted: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800',
};

const LETTER_STYLE: Record<string, string> = {
  A: 'bg-red-500 text-white border-red-500',
  B: 'bg-emerald-500 text-white border-emerald-500',
  C: 'bg-zinc-500 text-white border-zinc-500',
  '': 'bg-white dark:bg-zinc-900 text-zinc-400 border-zinc-300 dark:border-zinc-700',
};

const fmtShortDate = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '日付');

/** 日付ボタン：押すとブラウザ／端末のカレンダー（日付選択）を開く */
export function DueDateButton({
  value,
  todayStr,
  onChange,
  long = false,
  className = '',
}: {
  value: string;
  todayStr: string;
  onChange: (date: string) => void;
  long?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    const input = inputRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        return;
      }
    } catch {
      // showPicker が使えない環境はフォーカス／クリックで代用
    }
    input.focus();
    input.click();
  };
  const isToday = value && value === todayStr;
  const label = isToday ? '今日' : long ? value || '日付なし' : fmtShortDate(value);
  return (
    <span className={`relative inline-flex ${className}`} data-nodrag>
      <button
        type="button"
        onClick={open}
        className={`inline-flex items-center gap-1 h-8 px-1.5 rounded-lg border border-dashed text-[0.8125rem] font-bold whitespace-nowrap hover:border-solid hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer ${
          isToday ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100' : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
        }`}
        title="クリックして日付を変更"
        aria-label={`日付 ${value || 'なし'}（クリックで変更）`}
      >
        <CalendarDays className="w-3.5 h-3.5 flex-none" />
        <span>{label}</span>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        onChange={(e) => {
          if (e.target.value && e.target.value !== value) onChange(e.target.value);
        }}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute left-0 bottom-0 w-full h-px opacity-0 pointer-events-none"
      />
    </span>
  );
}

export function StatusSelect({ status, onChange, compact = false }: { status: TaskStatus; onChange: (s: TaskStatus) => void; compact?: boolean }) {
  return (
    <select
      value={status || 'pending'}
      onChange={(e) => onChange(e.target.value as TaskStatus)}
      onClick={(e) => e.stopPropagation()}
      className={`mini-select h-8 rounded-lg border text-[0.8125rem] font-bold cursor-pointer ${compact ? 'w-[4.9rem]' : 'w-[5.2rem]'} ${STATUS_STYLE[status || 'pending']}`}
      title="達成状況を変更"
      aria-label="達成状況"
    >
      <option value="pending">未達成</option>
      <option value="in_progress">・進行中</option>
      <option value="completed">✓完了</option>
      <option value="postponed">→先送り</option>
      <option value="delegated">○委任</option>
      <option value="deleted">×削除</option>
    </select>
  );
}

export function PrioritySelects({
  letter,
  number,
  onChange,
}: {
  letter: PriorityLetter;
  number: number | null;
  onChange: (letter: PriorityLetter, number: number | null, changed: 'letter' | 'number') => void;
}) {
  const maxNum = Math.max(20, (number || 0) + 5);
  return (
    <>
      <select
        value={letter}
        onChange={(e) => onChange(e.target.value as PriorityLetter, number, 'letter')}
        onClick={(e) => e.stopPropagation()}
        className={`mini-select h-8 w-[2.6rem] rounded-lg border text-[0.875rem] font-black cursor-pointer ${LETTER_STYLE[letter || '']}`}
        title="重要度を変更"
        aria-label="重要度"
      >
        <option value="">-</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
      </select>
      <select
        value={number === null ? '' : String(number)}
        onChange={(e) => onChange(letter, e.target.value === '' ? null : parseInt(e.target.value, 10), 'number')}
        onClick={(e) => e.stopPropagation()}
        className={`mini-select h-8 w-[2.9rem] rounded-lg border text-[0.875rem] font-black cursor-pointer ${
          number === null ? 'bg-white dark:bg-zinc-900 text-zinc-400 border-zinc-300 dark:border-zinc-700' : 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border-zinc-400 dark:border-zinc-500'
        }`}
        title="緊急度を変更"
        aria-label="緊急度"
      >
        <option value="">-</option>
        {Array.from({ length: maxNum }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </>
  );
}

/** 期日ソートの切り替えボタン（クリックごとに 昇順 ⇄ 降順） */
export function SortToggle({ dir, onToggle, label = '期日', className = '' }: { dir: SortDir; onToggle: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1 h-8 px-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[0.8125rem] font-black text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 underline decoration-dotted underline-offset-4 cursor-pointer whitespace-nowrap ${className}`}
      title={`${label}で並べ替え（今は${dir === 'asc' ? '昇順・古い順' : '降順・新しい順'}。クリックで切り替え）`}
      aria-label={`${label}で並べ替え ${dir === 'asc' ? '昇順' : '降順'}`}
      data-sort-dir={dir}
    >
      <span>{label}</span>
      {dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
    </button>
  );
}

/** 一覧の表ヘッダー用：期日（クリックでソート） */
export function SortHeader({ dir, onToggle }: { dir: SortDir | null; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-0.5 font-black text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white underline decoration-dotted underline-offset-4 cursor-pointer"
      title="クリックで期日の昇順・降順を切り替え"
      id="sort-due-header"
      data-sort-dir={dir || ''}
    >
      期日
      {dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : dir === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3.5 h-3.5" />}
    </button>
  );
}

export function StatusFilterSelect({ value, onChange, className = '' }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`min-w-0 px-2 h-8 text-[0.875rem] font-semibold bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-none text-zinc-700 dark:text-zinc-300 truncate ${className}`}
      aria-label="達成状況で絞り込み"
      title="達成状況で絞り込み"
    >
      {STATUS_FILTER_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export interface TaskRowHandlers {
  onStatus: (taskId: string, status: TaskStatus) => void;
  onPriority: (taskId: string, letter: PriorityLetter, number: number | null, changed: 'letter' | 'number') => void;
  onDate: (taskId: string, date: string) => void;
  onOpen: (taskId: string) => void;
}

/** 一覧の行と同じ列幅（ヘッダーと揃える） */
export const ROW_GRID = 'grid grid-cols-[5.2rem_5.75rem_minmax(0,1fr)_7.6rem] items-center gap-x-2';

export function TaskRow({
  task,
  layout,
  todayStr,
  handlers,
  dragProps,
  isDragging = false,
  longDate = false,
}: {
  task: Task;
  layout: 'row' | 'stack';
  todayStr: string;
  handlers: TaskRowHandlers;
  dragProps?: Record<string, unknown>;
  isDragging?: boolean;
  longDate?: boolean;
}) {
  const isCompleted = task.status === 'completed';
  const isDeleted = task.status === 'deleted';
  const title = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handlers.onOpen(task.id);
      }}
      className={`min-w-0 w-full text-left font-bold text-[0.875rem] leading-snug break-words hover:underline cursor-pointer text-zinc-800 dark:text-zinc-100 ${
        isCompleted ? 'line-through text-zinc-400 dark:text-zinc-500' : ''
      } ${isDeleted ? 'line-through text-red-500' : ''}`}
      title="タップで詳細を開く"
    >
      <span className={layout === 'stack' ? 'line-clamp-3' : 'line-clamp-2'}>{task.title}</span>
      {layout === 'row' && task.notes && (
        <span className="block text-[0.8125rem] font-medium text-zinc-400 dark:text-zinc-500 truncate no-underline">{task.notes}</span>
      )}
      {(task.reminderEnabled && task.reminderTime) || task.calendarExported ? (
        <span className="flex items-center gap-2 text-[0.75rem] font-bold mt-0.5">
          {task.reminderEnabled && task.reminderTime && (
            <span className="inline-flex items-center gap-0.5 text-sky-500"><Bell className="w-3 h-3" />{task.reminderTime}</span>
          )}
          {task.calendarExported && (
            <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><CalendarCheck className="w-3 h-3" />登録済</span>
          )}
        </span>
      ) : null}
    </button>
  );

  const statusSel = <StatusSelect status={task.status} compact={layout === 'stack'} onChange={(s) => handlers.onStatus(task.id, s)} />;
  const prio = (
    <span className="inline-flex gap-1">
      <PrioritySelects
        letter={task.priorityLetter}
        number={task.priorityNumber}
        onChange={(l, n, c) => handlers.onPriority(task.id, l, n, c)}
      />
    </span>
  );
  const date = <DueDateButton value={task.dueDate} todayStr={todayStr} long={longDate} onChange={(d) => handlers.onDate(task.id, d)} />;

  const base = `select-none rounded-lg transition-all ${isDragging ? 'opacity-40 ring-2 ring-sky-400' : ''} ${
    isCompleted ? 'opacity-70' : ''
  } ${isDeleted ? 'opacity-50' : ''}`;
  const style: React.CSSProperties = { WebkitTouchCallout: 'none' };

  if (layout === 'stack') {
    return (
      <div
        {...dragProps}
        style={style}
        className={`${base} p-1.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/60 hover:border-zinc-400 dark:hover:border-zinc-600 flex flex-col gap-1 ${dragProps ? 'cursor-grab active:cursor-grabbing' : ''}`}
        id={`task-card-${task.id}`}
      >
        <div className="flex items-center gap-1 flex-wrap">
          {statusSel}
          {prio}
          <span className="ml-auto">{date}</span>
        </div>
        {title}
      </div>
    );
  }

  return (
    <div
      {...dragProps}
      style={style}
      className={`${base} ${ROW_GRID} px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 ${dragProps ? 'cursor-grab active:cursor-grabbing' : ''}`}
      id={`task-row-${task.id}`}
    >
      {statusSel}
      {prio}
      {title}
      <span className="flex justify-end">{date}</span>
    </div>
  );
}

/** 行レイアウトのヘッダー */
export function TaskRowHeader({ sortDir, onToggleSort }: { sortDir: SortDir; onToggleSort: () => void }) {
  return (
    <div className={`${ROW_GRID} px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 rounded-t-lg`}>
      <span className="text-center">達成状況</span>
      <span className="text-center">重要度・緊急度</span>
      <span>タスク内容（タップで詳細）</span>
      <span className="text-right pr-1"><SortHeader dir={sortDir} onToggle={onToggleSort} /></span>
    </div>
  );
}

/** ドラッグ中に指／カーソルについてくる表示 */
export function DragGhost({ visual }: { visual: { title: string; x: number; y: number } | null }) {
  if (!visual) return null;
  return (
    <div
      className="fixed z-[200] pointer-events-none px-3 py-2 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-bold shadow-2xl max-w-[16rem] truncate"
      style={{ left: visual.x + 12, top: visual.y + 12 }}
      id="drag-ghost"
    >
      {visual.title}
    </div>
  );
}
