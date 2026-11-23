import { carryOverOverdueTasks } from './carryOver';
import type { Task, TaskStatus } from '../types';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const today = '2026-11-23';
const now = '2026-11-23T01:00:00.000Z';
const mk = (over: Partial<Task> & { id: string; dueDate?: string; status?: TaskStatus }): Task => ({
  userId: 'u',
  title: over.title ?? over.id,
  notes: 'memo',
  priorityLetter: 'B',
  priorityNumber: 3,
  quadrant: 'II',
  reminderTime: '08:00',
  reminderEnabled: true,
  reminderNotified: true,
  completed: over.status === 'completed',
  completedAt: over.status === 'completed' ? now : null,
  completedDate: over.status === 'completed' ? '2026-11-20' : '',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  dueDate: '',
  status: 'pending',
  ...over,
});

test('moves overdue incomplete tasks to today and leaves others alone', () => {
  const tasks = [
    mk({ id: 'old-pending', dueDate: '2026-11-22', status: 'pending' }),
    mk({ id: 'older-progress', dueDate: '2026-11-01', status: 'in_progress', priorityLetter: 'A', priorityNumber: 1 }),
    mk({ id: 'old-postponed', dueDate: '2026-11-21', status: 'postponed' }),
    mk({ id: 'old-delegated', dueDate: '2026-11-10', status: 'delegated' }),
    mk({ id: 'today-ok', dueDate: today, status: 'pending' }),
    mk({ id: 'future', dueDate: '2026-11-24', status: 'pending' }),
    mk({ id: 'done-old', dueDate: '2026-11-20', status: 'completed' }),
    mk({ id: 'deleted-old', dueDate: '2026-11-20', status: 'deleted' }),
    mk({ id: 'no-date', dueDate: '', status: 'pending' }),
  ];
  const { tasks: next, movedCount, movedIds } = carryOverOverdueTasks(tasks, today, now);
  assert.equal(movedCount, 4);
  assert.deepEqual(movedIds, ['old-pending', 'older-progress', 'old-postponed', 'old-delegated']);
  const byId = Object.fromEntries(next.map((t) => [t.id, t]));
  assert.equal(byId['old-pending'].dueDate, today);
  assert.equal(byId['older-progress'].dueDate, today);
  assert.equal(byId['older-progress'].priorityLetter, 'A');
  assert.equal(byId['older-progress'].priorityNumber, 1);
  assert.equal(byId['older-progress'].status, 'in_progress');
  assert.equal(byId['older-progress'].notes, 'memo');
  assert.equal(byId['older-progress'].reminderEnabled, true);
  assert.equal(byId['older-progress'].reminderTime, '08:00');
  assert.equal(byId['older-progress'].reminderNotified, false);
  assert.equal(byId['older-progress'].updatedAt, now);
  assert.equal(byId['today-ok'].dueDate, today);
  assert.equal(byId['today-ok'].updatedAt, '2026-11-20T00:00:00.000Z');
  assert.equal(byId['future'].dueDate, '2026-11-24');
  assert.equal(byId['done-old'].dueDate, '2026-11-20');
  assert.equal(byId['done-old'].status, 'completed');
  assert.equal(byId['deleted-old'].dueDate, '2026-11-20');
  assert.equal(byId['no-date'].dueDate, '');
});

test('is idempotent when already on today', () => {
  const tasks = [mk({ id: 'a', dueDate: '2026-11-22', status: 'pending' })];
  const first = carryOverOverdueTasks(tasks, today, now);
  const second = carryOverOverdueTasks(first.tasks, today, '2026-11-23T09:00:00.000Z');
  assert.equal(second.movedCount, 0);
  assert.equal(second.tasks, first.tasks);
  assert.equal(second.tasks[0].updatedAt, now);
});

test('returns the same array when nothing to move', () => {
  const tasks = [mk({ id: 'done', dueDate: '2026-11-01', status: 'completed' })];
  const r = carryOverOverdueTasks(tasks, today, now);
  assert.equal(r.movedCount, 0);
  assert.equal(r.tasks, tasks);
});
