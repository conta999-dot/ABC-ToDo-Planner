import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLANK_TAG_ID, PRIVATE_TAG_ID, WORK_TAG_ID, Task } from '../types';
import {
  defaultTagSettings,
  normalizeTagSettings,
  addTag,
  renameTag,
  deleteTag,
  setDefaultTag,
  mergeTagSettings,
  findTag,
  isBlankTagId,
  shouldRegisterOnEnter,
  isImeConfirmEnter,
  countTasksWithTag,
} from './tags';

const now = '2026-11-23T02:00:00.000Z';
const mkTask = (id: string, tagId?: string): Task => ({
  id, userId: 'u', title: id, notes: '', priorityLetter: 'B', priorityNumber: 1, quadrant: 'II',
  dueDate: '2026-11-23', reminderTime: '', reminderEnabled: false, reminderNotified: false,
  completed: false, status: 'pending', completedAt: null, completedDate: '',
  createdAt: now, updatedAt: now, tagId,
});

test('defaults are プライベート, 仕事, 空欄 and default is 空欄', () => {
  const s = defaultTagSettings(now);
  assert.equal(s.defaultTagId, BLANK_TAG_ID);
  assert.deepEqual(s.tags.map((t) => t.name), ['空欄', 'プライベート', '仕事']);
  assert.ok(s.tags[0].isBlank);
});

test('normalize always keeps 空欄 and falls back default', () => {
  const s = normalizeTagSettings({ tags: [{ id: 'x', name: '趣味' }], defaultTagId: 'missing' }, now);
  assert.ok(s.tags.some((t) => t.id === BLANK_TAG_ID));
  assert.equal(s.defaultTagId, BLANK_TAG_ID);
  assert.ok(s.tags.some((t) => t.name === '趣味'));
});

test('add, rename, set default', () => {
  let s = defaultTagSettings(now);
  const added = addTag(s, ' 家族 ', now);
  assert.ok(added.tag);
  s = added.settings;
  assert.ok(s.tags.some((t) => t.name === '家族'));
  const renamed = renameTag(s, added.tag!.id, '家庭', now);
  assert.ok(!renamed.error);
  s = renamed.settings;
  assert.ok(s.tags.some((t) => t.name === '家庭'));
  const def = setDefaultTag(s, added.tag!.id, now);
  assert.equal(def.settings.defaultTagId, added.tag!.id);
  assert.ok(addTag(s, '家庭', now).error);
  assert.ok(renameTag(s, BLANK_TAG_ID, 'なし', now).error);
  assert.ok(addTag(s, '空欄', now).error);
});

test('delete tag moves tasks to 空欄 and resets default', () => {
  let s = defaultTagSettings(now);
  s = setDefaultTag(s, WORK_TAG_ID, now).settings;
  const tasks = [mkTask('a', WORK_TAG_ID), mkTask('b', PRIVATE_TAG_ID), mkTask('c', WORK_TAG_ID), mkTask('d')];
  assert.equal(countTasksWithTag(tasks, WORK_TAG_ID), 2);
  const delBlank = deleteTag(s, tasks, BLANK_TAG_ID, now);
  assert.ok(delBlank.error);
  const del = deleteTag(s, tasks, WORK_TAG_ID, now);
  assert.equal(del.movedCount, 2);
  assert.equal(del.settings.defaultTagId, BLANK_TAG_ID);
  assert.ok(!del.settings.tags.some((t) => t.id === WORK_TAG_ID));
  assert.equal(del.tasks.find((t) => t.id === 'a')?.tagId, BLANK_TAG_ID);
  assert.equal(del.tasks.find((t) => t.id === 'b')?.tagId, PRIVATE_TAG_ID);
  assert.equal(findTag(del.settings, 'a-missing').id, BLANK_TAG_ID);
  assert.ok(isBlankTagId(undefined));
  assert.ok(isBlankTagId(BLANK_TAG_ID));
});

test('merge prefers newer updatedAt and pushes when local is newer or cloud missing', () => {
  const local = defaultTagSettings('2026-11-23T03:00:00.000Z');
  const cloud = { ...defaultTagSettings('2026-11-23T01:00:00.000Z'), defaultTagId: WORK_TAG_ID };
  const a = mergeTagSettings(local, null);
  assert.equal(a.shouldPush, true);
  const b = mergeTagSettings(local, cloud);
  assert.equal(b.shouldPush, true);
  assert.equal(b.settings.defaultTagId, BLANK_TAG_ID);
  const c = mergeTagSettings(defaultTagSettings('2026-11-23T00:00:00.000Z'), cloud);
  assert.equal(c.shouldPush, false);
  assert.equal(c.settings.defaultTagId, WORK_TAG_ID);
});

test('IME Enter does not register, following Enter does', () => {
  assert.equal(isImeConfirmEnter({ isComposing: true, keyCode: 229 }), true);
  assert.equal(isImeConfirmEnter({ isComposing: false, keyCode: 229 }), true);
  assert.equal(isImeConfirmEnter({ isComposing: false, keyCode: 13 }), false);
  assert.equal(shouldRegisterOnEnter({ key: 'Enter', isComposing: true, keyCode: 229 }), false);
  assert.equal(shouldRegisterOnEnter({ key: 'Enter', nativeEvent: { isComposing: true, keyCode: 229 } }), false);
  assert.equal(shouldRegisterOnEnter({ key: 'Enter', isComposing: false, keyCode: 13 }), true);
  assert.equal(shouldRegisterOnEnter({ key: 'a', isComposing: false, keyCode: 65 }), false);
});

test('old tasks without tagId are 空欄', () => {
  const s = defaultTagSettings(now);
  assert.equal(findTag(s, undefined).id, BLANK_TAG_ID);
  assert.equal(findTag(s, '').id, BLANK_TAG_ID);
});
