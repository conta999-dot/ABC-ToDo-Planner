/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PriorityLetter = 'A' | 'B' | 'C' | '';

export type TaskQuadrant = 'I' | 'II' | 'III' | 'IV';

export type TaskStatus = 'pending' | 'completed' | 'postponed' | 'delegated' | 'in_progress' | 'deleted';

export interface Task {
  id: string;
  userId: string;
  title: string;
  notes: string;
  priorityLetter: PriorityLetter; // A, B, C, or '' (empty)
  priorityNumber: number | null; // 1, 2, 3... or null (empty)
  quadrant: TaskQuadrant;        // I, II, III, IV
  dueDate: string;               // YYYY-MM-DD
  reminderTime: string;          // HH:MM (空文字は未設定)
  reminderEnabled: boolean;
  reminderNotified: boolean;     // すでに通知されたかどうか
  completed: boolean;            // バックワード互換（status === 'completed'）
  status: TaskStatus;            // 未達成、完了、先送り、委任、進行中、削除
  completedAt: string | null;    // ISO文字列、カレンダーインポート用
  completedDate?: string;        // 完了日（YYYY-MM-DD）
  createdAt: string;             // ISO文字列
  updatedAt: string;             // ISO文字列
  copiedFromId?: string;         // 翌日コピー元タスクID
  /** カレンダーへエクスポート済みか（どこかの端末で1回でも登録したら true） */
  calendarExported?: boolean;
  /** エクスポート記録。キーは `${deviceId}_${calendarId}`（端末・カレンダーごと） */
  calendarExports?: Record<string, CalendarExportRecord>;
}

export interface CalendarExportRecord {
  deviceId: string;     // アプリをインストールした端末ごとのID
  calendarId: string;   // 端末内カレンダーのID
  eventId: string;      // 端末内カレンダーの予定ID（_id）
  exportedAt: string;   // ISO文字列
  hash: string;         // 登録した内容（タイトル・日付・説明）のハッシュ。空なら次回必ず更新
}

export const getTaskQuadrant = (priorityLetter: PriorityLetter, priorityNumber: number | null): TaskQuadrant => {
  // 重要 (A) かつ 緊急 (数字入りすべて または 未設定) -> 第Ⅰ領域
  if (priorityLetter === 'A') {
    return 'I';
  }
  // 重要 (B) かつ 緊急ではない (数字入りすべて または 未設定) -> 第Ⅱ領域
  if (priorityLetter === 'B') {
    return 'II';
  }
  // 重要ではない (未設定 または C) かつ 緊急 (数字入りすべて) -> 第Ⅲ領域
  if ((priorityLetter === '' || priorityLetter === 'C') && priorityNumber !== null) {
    return 'III';
  }
  // 重要ではない (未設定 または C) かつ 緊急ではない (未設定) -> 第Ⅳ領域
  return 'IV';
};

export const TASK_STATUS_OPTIONS = [
  { value: 'pending', label: '未達成', symbol: '' },
  { value: 'completed', label: '完了', symbol: '✓' },
  { value: 'postponed', label: '先送り', symbol: '→' },
  { value: 'delegated', label: '委任', symbol: '○' },
  { value: 'in_progress', label: '進行中', symbol: '・' },
  { value: 'deleted', label: '削除', symbol: '×' },
] as const;

export const getStatusSymbol = (status: TaskStatus): string => {
  switch (status) {
    case 'completed': return '✓';
    case 'postponed': return '→';
    case 'delegated': return '○';
    case 'in_progress': return '・';
    case 'deleted': return '×';
    default: return '';
  }
};

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}
