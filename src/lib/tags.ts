import { BLANK_TAG_ID, PRIVATE_TAG_ID, WORK_TAG_ID, Tag, TagSettings, Task } from '../types';
import { newTaskId } from './dates';
import { findTagColor } from './tagColors';

export const TAG_STORAGE_KEY = 'abc_planner_tags_v1';
export const INITIAL_TAG_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export const BLANK_TAG: Tag = { id: BLANK_TAG_ID, name: '空欄', isBlank: true };

export const defaultTagSettings = (nowIso: string = INITIAL_TAG_UPDATED_AT): TagSettings => ({
  tags: [
    { ...BLANK_TAG },
    { id: PRIVATE_TAG_ID, name: 'プライベート' },
    { id: WORK_TAG_ID, name: '仕事' },
  ],
  defaultTagId: BLANK_TAG_ID,
  updatedAt: nowIso,
});

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const normalizeTagSettings = (raw: unknown, nowIso: string = new Date().toISOString()): TagSettings => {
  const fallback = defaultTagSettings(nowIso);
  if (!isRecord(raw)) return fallback;
  const list = Array.isArray(raw.tags) ? raw.tags : [];
  const tags: Tag[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === BLANK_TAG_ID || item.isBlank === true) {
      tags.push({ ...BLANK_TAG });
      continue;
    }
    if (!name) continue;
    const color = typeof item.color === 'string' && findTagColor(item.color) ? item.color : undefined;
    tags.push(color ? { id, name, color } : { id, name });
  }
  if (!tags.some((t) => t.id === BLANK_TAG_ID)) tags.unshift({ ...BLANK_TAG });
  // 空欄は常に先頭
  tags.sort((a, b) => Number(!!b.isBlank) - Number(!!a.isBlank) || a.name.localeCompare(b.name, 'ja'));
  const blankFirst = [
    ...tags.filter((t) => t.id === BLANK_TAG_ID),
    ...tags.filter((t) => t.id !== BLANK_TAG_ID),
  ];
  let defaultTagId = typeof raw.defaultTagId === 'string' ? raw.defaultTagId : BLANK_TAG_ID;
  if (!blankFirst.some((t) => t.id === defaultTagId)) defaultTagId = BLANK_TAG_ID;
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowIso;
  return { tags: blankFirst, defaultTagId, updatedAt };
};

export const loadLocalTagSettings = (): TagSettings => {
  try {
    const raw = localStorage.getItem(TAG_STORAGE_KEY);
    if (!raw) return defaultTagSettings();
    return normalizeTagSettings(JSON.parse(raw));
  } catch {
    return defaultTagSettings();
  }
};

export const saveLocalTagSettings = (settings: TagSettings): void => {
  try {
    localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
};

export const findTag = (settings: TagSettings, tagId?: string | null): Tag => {
  if (!tagId) return BLANK_TAG;
  return settings.tags.find((t) => t.id === tagId) || BLANK_TAG;
};

export const isBlankTagId = (tagId?: string | null): boolean => !tagId || tagId === BLANK_TAG_ID;

export const addTag = (settings: TagSettings, name: string, nowIso: string = new Date().toISOString()): { settings: TagSettings; error?: string; tag?: Tag } => {
  const trimmed = name.trim();
  if (!trimmed) return { settings, error: 'タグ名を入力してください' };
  if (trimmed === '空欄') return { settings, error: '「空欄」は固定の項目なので追加できません' };
  if (settings.tags.some((t) => t.name === trimmed)) return { settings, error: '同じ名前のタグがすでにあります' };
  const tag: Tag = { id: `tag-${newTaskId()}`, name: trimmed };
  return {
    settings: { ...settings, tags: [...settings.tags, tag], updatedAt: nowIso },
    tag,
  };
};

export const renameTag = (settings: TagSettings, tagId: string, name: string, nowIso: string = new Date().toISOString()): { settings: TagSettings; error?: string } => {
  const tag = settings.tags.find((t) => t.id === tagId);
  if (!tag) return { settings, error: 'タグが見つかりません' };
  if (tag.isBlank || tag.id === BLANK_TAG_ID) return { settings, error: '「空欄」は改名できません' };
  const trimmed = name.trim();
  if (!trimmed) return { settings, error: 'タグ名を入力してください' };
  if (trimmed === '空欄') return { settings, error: '「空欄」は固定の項目です' };
  if (settings.tags.some((t) => t.id !== tagId && t.name === trimmed)) return { settings, error: '同じ名前のタグがすでにあります' };
  return {
    settings: {
      ...settings,
      tags: settings.tags.map((t) => (t.id === tagId ? { ...t, name: trimmed } : t)),
      updatedAt: nowIso,
    },
  };
};

export const countTasksWithTag = (tasks: Task[], tagId: string): number =>
  tasks.filter((t) => t.status !== 'deleted' && t.tagId === tagId).length;

/** タグの文字色を変える（key が空・不明なら色なしに戻す。空欄タグは色なし固定） */
export const setTagColor = (settings: TagSettings, tagId: string, colorKey: string | null, nowIso: string = new Date().toISOString()): { settings: TagSettings; error?: string } => {
  const tag = settings.tags.find((t) => t.id === tagId);
  if (!tag) return { settings, error: 'タグが見つかりません' };
  if (tag.isBlank || tag.id === BLANK_TAG_ID) return { settings, error: '「空欄」には色を付けられません' };
  const color = colorKey && findTagColor(colorKey) ? colorKey : undefined;
  return {
    settings: {
      ...settings,
      tags: settings.tags.map((t) => {
        if (t.id !== tagId) return t;
        const { color: _old, ...rest } = t;
        void _old;
        return color ? { ...rest, color } : rest;
      }),
      updatedAt: nowIso,
    },
  };
};

/** タグを削除する。空欄は削除不可。付いているタスクは空欄（tagId を外す）にする。デフォルトなら空欄に戻す。 */
export const deleteTag = (
  settings: TagSettings,
  tasks: Task[],
  tagId: string,
  nowIso: string = new Date().toISOString(),
): { settings: TagSettings; tasks: Task[]; movedCount: number; error?: string } => {
  const tag = settings.tags.find((t) => t.id === tagId);
  if (!tag) return { settings, tasks, movedCount: 0, error: 'タグが見つかりません' };
  if (tag.isBlank || tag.id === BLANK_TAG_ID) return { settings, tasks, movedCount: 0, error: '「空欄」は削除できません' };
  let movedCount = 0;
  const nextTasks = tasks.map((t) => {
    if (t.tagId !== tagId) return t;
    movedCount++;
    return { ...t, tagId: BLANK_TAG_ID, updatedAt: nowIso };
  });
  const nextDefault = settings.defaultTagId === tagId ? BLANK_TAG_ID : settings.defaultTagId;
  return {
    settings: {
      ...settings,
      tags: settings.tags.filter((t) => t.id !== tagId),
      defaultTagId: nextDefault,
      updatedAt: nowIso,
    },
    tasks: movedCount ? nextTasks : tasks,
    movedCount,
  };
};

export const setDefaultTag = (settings: TagSettings, tagId: string, nowIso: string = new Date().toISOString()): { settings: TagSettings; error?: string } => {
  if (!settings.tags.some((t) => t.id === tagId)) return { settings, error: 'タグが見つかりません' };
  return { settings: { ...settings, defaultTagId: tagId, updatedAt: nowIso } };
};

/** 2つの設定を updatedAt の新しい方で採用（同じなら cloud 優先） */
export const mergeTagSettings = (local: TagSettings, cloud: TagSettings | null): { settings: TagSettings; shouldPush: boolean } => {
  if (!cloud) return { settings: local, shouldPush: true };
  const localTime = Date.parse(local.updatedAt) || 0;
  const cloudTime = Date.parse(cloud.updatedAt) || 0;
  if (localTime > cloudTime) return { settings: local, shouldPush: true };
  return { settings: cloud, shouldPush: false };
};

/** IME の変換確定の Enter では登録しない（isComposing または keyCode 229） */
export const isImeConfirmEnter = (e: { isComposing?: boolean; keyCode?: number; which?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number; which?: number } }): boolean => {
  const ev = e.nativeEvent ?? e;
  const code = ev.keyCode ?? ev.which;
  return !!(ev.isComposing || code === 229);
};

export const shouldRegisterOnEnter = (e: { key?: string; isComposing?: boolean; keyCode?: number; which?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number; which?: number } }): boolean => {
  if (e.key !== 'Enter') return false;
  return !isImeConfirmEnter(e);
};
