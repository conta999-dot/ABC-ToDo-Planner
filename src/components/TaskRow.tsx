/**
 * すべてのタブで共通のタスク行（v0.6.0）
 * - 達成状況・重要度・緊急度はプルダウンでその場で変更
 * - タスク内容をタップ／クリックすると詳細画面へ
 * - 日付をタップ／クリックするとカレンダー（日付選択）が開く
 */
import React, { useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, CalendarCheck } from 'lucide-react';
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

/** 以前の版と同じ見た目: 達成状況の記号ボックス */
const STATUS_BOX: Record<TaskStatus, { symbol: string; label: string; cls: string }> = {
  pending: { symbol: '', label: '未達成', cls: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border-zinc-300 dark:border-zinc-700' },
  in_progress: { symbol: '・', label: '進行中', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  completed: { symbol: '✓', label: '完了', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  postponed: { symbol: '→', label: '先送り', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30' },
  delegated: { symbol: '○', label: '委任', cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30' },
  deleted: { symbol: '×', label: '削除', cls: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30' },
};

const LETTER_BADGE: Record<string, string> = {
  A: 'bg-red-500 text-white',
  B: 'bg-emerald-500 text-white',
  C: 'bg-zinc-500 text-white',
};

const fmtShortDate = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '日付');

/** 日付ボタン：押すとブラウザ／端末のカレンダー（日付選択）を開く */
export function DueDateButton({
  value,
  todayStr,
  onChange,
  mode = 'short',
  className = '',
}: {
  value: string;
  todayStr: string;
  onChange: (date: string) => void;
  mode?: 'full' | 'short' | 'icon';
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
  const label = isToday ? '今日' : mode === 'full' ? value || '日付なし' : fmtShortDate(value);
  return (
    <span className={`relative inline-flex ${className}`} data-nodrag>
      <button
        type="button"
        onClick={open}
        className={`inline-flex items-center gap-1 h-7 px-1 rounded-md border border-dashed text-[0.8125rem] font-bold whitespace-nowrap hover:border-solid hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer ${
          isToday ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100' : 'border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
        }`}
        title="クリックして日付を変更"
        aria-label={`日付 ${value || 'なし'}（クリックで変更）`}
      >
        <CalendarDays className="w-3.5 h-3.5 flex-none" />
        {mode !== 'icon' && <span>{label}</span>}
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

/**
 * 達成状況: 記号ボックス（✓ ・ → ○ × 空欄）。押すと端末／ブラウザ標準の選択リストが開く。
 * 透明な <select> をボックスの上に重ねているので、Android ではネイティブの選択ダイアログになる。
 */
export function StatusSelect({ status, onChange }: { status: TaskStatus; onChange: (s: TaskStatus) => void }) {
  const info = STATUS_BOX[status || 'pending'];
  return (
    <span className="relative inline-flex flex-none w-7 h-7" data-nodrag>
      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border text-xs font-black ${info.cls}`} aria-hidden="true">
        {info.symbol || <span className="w-3.5 h-3.5 rounded-full border border-zinc-300 dark:border-zinc-600" />}
      </span>
      <select
        value={status || 'pending'}
        onChange={(e) => onChange(e.target.value as TaskStatus)}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        title={`達成状況を変更（${info.label}）`}
        aria-label={`達成状況: ${info.label}`}
      >
        <option value="pending">未達成</option>
        <option value="in_progress">進行中 (・)</option>
        <option value="completed">完了 (✓)</option>
        <option value="postponed">先送り (→)</option>
        <option value="delegated">委任 (○)</option>
        <option value="deleted">削除 (×)</option>
      </select>
    </span>
  );
}

/**
 * 重要度・緊急度: 「B1」のような色付きバッジ。押すと A1〜／B1〜／C1〜 をまとめた選択リストが開く（以前の版と同じ）。
 */
export function PriorityBadgeSelect({
  letter,
  number,
  onChange,
}: {
  letter: PriorityLetter;
  number: number | null;
  onChange: (letter: PriorityLetter, number: number | null) => void;
}) {
  const value = letter ? `${letter}${number ?? ''}` : number !== null ? `-${number}` : '';
  const maxNum = Math.max(10, (number || 0));
  const nums = Array.from({ length: maxNum }, (_, i) => i + 1);
  const label = letter ? `${letter}${number ?? ''}` : number !== null ? `${number}` : '-';
  return (
    <span className="relative inline-flex flex-none" data-nodrag>
      <span
        className={`inline-flex items-center justify-center min-w-[2.4rem] h-7 px-1.5 rounded-md text-[0.8125rem] font-black tracking-wide ${
          letter ? LETTER_BADGE[letter] : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border border-zinc-300 dark:border-zinc-700'
        }`}
        aria-hidden="true"
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) onChange('', null);
          else if (v.startsWith('-')) onChange('', parseInt(v.slice(1), 10));
          else onChange(v.charAt(0) as PriorityLetter, v.length > 1 ? parseInt(v.slice(1), 10) : null);
        }}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        title="重要度・緊急度を変更"
        aria-label={`重要度・緊急度: ${label}`}
      >
        <option value="">なし</option>
        {(['A', 'B', 'C'] as const).map((L) => (
          <optgroup key={L} label={L === 'A' ? 'A (最重要)' : L === 'B' ? 'B (重要)' : 'C (重要ではない)'}>
            {letter === L && number === null && <option value={L}>{L}</option>}
            {nums.map((n) => (
              <option key={`${L}${n}`} value={`${L}${n}`}>{`${L}${n}`}</option>
            ))}
          </optgroup>
        ))}
        {!letter && number !== null && (
          <optgroup label="重要度なし">
            <option value={`-${number}`}>{number}</option>
          </optgroup>
        )}
      </select>
    </span>
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
  onPriority: (taskId: string, letter: PriorityLetter, number: number | null) => void;
  onDate: (taskId: string, date: string) => void;
  onOpen: (taskId: string) => void;
}

export type DateMode = 'full' | 'short' | 'icon';

/** 一行表示の列: 達成状況 | 優先度 | タスク内容（長いときだけ折り返し） | 期日 */
export const rowGrid = (mode: DateMode) =>
  `grid ${mode === 'full' ? 'grid-cols-[1.75rem_auto_minmax(0,1fr)_7.6rem]' : mode === 'short' ? 'grid-cols-[1.75rem_auto_minmax(0,1fr)_auto]' : 'grid-cols-[1.75rem_auto_minmax(0,1fr)_auto]'} items-center gap-x-1.5 sm:gap-x-2`;

/** すべてのタブで共通の「一行」タスク表示 */
export function TaskRow({
  task,
  todayStr,
  handlers,
  dateMode = 'short',
  dragProps,
  isDragging = false,
  showNotes = false,
}: {
  task: Task;
  todayStr: string;
  handlers: TaskRowHandlers;
  dateMode?: DateMode;
  dragProps?: Record<string, unknown>;
  isDragging?: boolean;
  showNotes?: boolean;
}) {
  const isCompleted = task.status === 'completed';
  const isDeleted = task.status === 'deleted';
  return (
    <div
      {...dragProps}
      style={{ WebkitTouchCallout: 'none' }}
      className={`${rowGrid(dateMode)} select-none px-1.5 py-1 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${
        dragProps ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isDragging ? 'opacity-40 ring-2 ring-sky-400' : ''} ${isCompleted ? 'opacity-65' : ''} ${isDeleted ? 'opacity-50' : ''}`}
      id={`task-row-${task.id}`}
    >
      <StatusSelect status={task.status} onChange={(s) => handlers.onStatus(task.id, s)} />
      <PriorityBadgeSelect letter={task.priorityLetter} number={task.priorityNumber} onChange={(l, n) => handlers.onPriority(task.id, l, n)} />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpen(task.id);
        }}
        className={`min-w-0 text-left text-[0.875rem] font-semibold leading-snug break-words hover:underline cursor-pointer text-zinc-800 dark:text-zinc-100 ${
          isCompleted ? 'line-through text-zinc-400 dark:text-zinc-500' : ''
        } ${isDeleted ? 'line-through text-red-500' : ''}`}
        title="タップで詳細を開く"
      >
        {task.title}
        {task.calendarExported && (
          <CalendarCheck className="ml-1 inline w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 align-middle" aria-label="カレンダー登録済" />
        )}
        {showNotes && task.notes && (
          <span className="block text-[0.8125rem] font-medium text-zinc-400 dark:text-zinc-500 truncate">{task.notes}</span>
        )}
      </button>
      <span className="flex justify-end">
        <DueDateButton value={task.dueDate} todayStr={todayStr} mode={dateMode} onChange={(d) => handlers.onDate(task.id, d)} />
      </span>
    </div>
  );
}

/** 一覧（PC）の表ヘッダー */
export function TaskRowHeader({ sortDir, onToggleSort }: { sortDir: SortDir; onToggleSort: () => void }) {
  return (
    <div className={`${rowGrid('full')} px-1.5 py-1.5 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 text-[0.8125rem] font-bold text-zinc-400 dark:text-zinc-500 rounded-t-lg`}>
      <span className="text-center leading-tight text-[0.75rem]">状況</span>
      <span className="text-center min-w-[2.4rem]">優先度</span>
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
