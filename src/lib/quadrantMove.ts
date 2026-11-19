/**
 * 「4つの領域」タブでタスクを別の領域へドロップしたときの重要度・緊急度の変え方（v0.6.0）
 *
 * 領域の判定（types.ts の getTaskQuadrant）:
 *   重要度 A                       → 第Ⅰ領域
 *   重要度 B                       → 第Ⅱ領域
 *   重要度 C/なし ＋ 緊急度（数字）あり → 第Ⅲ領域
 *   重要度 C/なし ＋ 緊急度なし        → 第Ⅳ領域
 *
 * ドロップ先ごとの変更（その領域に入る最小限の変更）:
 *   第Ⅰ領域へ: 重要度を A に。緊急度は「A の中で次の番号」（A の最大番号＋1）＝ A の列の最後に並ぶ
 *   第Ⅱ領域へ: 重要度を B に。緊急度は「B の中で次の番号」
 *   第Ⅲ領域へ: 重要度 A/B は C に、C/なし はそのまま。緊急度は「その重要度の中で次の番号」
 *   第Ⅳ領域へ: 重要度 A/B は C に、C/なし はそのまま。緊急度は なし
 *   同じ領域へのドロップは何も変えない
 */
import { PriorityLetter, Task, TaskQuadrant, getTaskQuadrant } from '../types';

/** 同じ重要度（なし も含む）の中で、いちばん大きい緊急度＋1（ひとつもなければ 1） */
export const nextNumberForLetter = (tasks: Task[], letter: PriorityLetter, excludeId?: string): number => {
  const nums = tasks
    .filter((t) => t.id !== excludeId && (t.priorityLetter || '') === letter && typeof t.priorityNumber === 'number' && !isNaN(t.priorityNumber))
    .map((t) => t.priorityNumber as number);
  return nums.length ? Math.max(...nums) + 1 : 1;
};

export const priorityForQuadrant = (
  task: Task,
  target: TaskQuadrant,
  allTasks: Task[]
): { letter: PriorityLetter; number: number | null } | null => {
  if (getTaskQuadrant(task.priorityLetter, task.priorityNumber) === target) return null;
  const lowLetter: PriorityLetter = task.priorityLetter === 'A' || task.priorityLetter === 'B' ? 'C' : task.priorityLetter;
  switch (target) {
    case 'I':
      return { letter: 'A', number: nextNumberForLetter(allTasks, 'A', task.id) };
    case 'II':
      return { letter: 'B', number: nextNumberForLetter(allTasks, 'B', task.id) };
    case 'III':
      return { letter: lowLetter, number: nextNumberForLetter(allTasks, lowLetter, task.id) };
    case 'IV':
    default:
      return { letter: lowLetter, number: null };
  }
};

export const QUADRANT_DROP_RULE: Record<TaskQuadrant, string> = {
  I: '重要度を A にし、緊急度は A の中で次の番号（例: A1〜A3 があれば A4）にします。',
  II: '重要度を B にし、緊急度は B の中で次の番号にします。',
  III: '重要度 A・B は C に変え（C・なしはそのまま）、緊急度はその中で次の番号にします。',
  IV: '重要度 A・B は C に変え（C・なしはそのまま）、緊急度をなしにします。',
};
