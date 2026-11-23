import { Task } from '../types';

/**
 * 起動時・日付が変わったときの繰り越し（v0.7.0〜）
 * 昨日以前の未完了タスク（削除・完了以外）の実施予定日を today（YYYY-MM-DD）に移す。
 * 日付なし・完了・削除は触らない。優先度など他の項目はそのまま。同じ today なら何度呼んでも変化しない。
 */
export const carryOverOverdueTasks = (
  tasks: Task[],
  today: string,
  nowIso: string = new Date().toISOString(),
): { tasks: Task[]; movedCount: number; movedIds: string[] } => {
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return { tasks, movedCount: 0, movedIds: [] };
  }
  const movedIds: string[] = [];
  let changed = false;
  const next = tasks.map((t) => {
    if (t.status === 'completed' || t.status === 'deleted') return t;
    if (!t.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)) return t;
    if (t.dueDate >= today) return t;
    changed = true;
    movedIds.push(t.id);
    return { ...t, dueDate: today, reminderNotified: false, updatedAt: nowIso };
  });
  return { tasks: changed ? next : tasks, movedCount: movedIds.length, movedIds };
};
