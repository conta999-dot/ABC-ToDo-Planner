/**
 * タスクのドラッグ＆ドロップ（マウス・タッチ両対応、外部ライブラリなし）
 *
 * - マウス: 左ボタンを押したまま 6px 以上動かすとドラッグ開始
 * - タッチ: 250ms 長押しでドラッグ開始（その前に指が動いたら通常のスクロール）
 * - ドロップ先は data-drop-kind / data-drop-value 属性を持つ要素
 *   （例: data-drop-kind="date" data-drop-value="2026-11-20"、data-drop-kind="quadrant" data-drop-value="II"）
 * - ドラッグ中はスクロール領域（#view-panel-viewport など）の端に近づくと自動スクロール
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export type DropKind = 'date' | 'quadrant';
export interface DropTarget {
  kind: DropKind;
  value: string;
}

interface DragState {
  taskId: string;
  title: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  cleanup: () => void;
}

export interface DragVisual {
  taskId: string;
  title: string;
  x: number;
  y: number;
}

const NO_DRAG_SELECTOR = 'select, input, textarea, option, [data-nodrag]';
const MOUSE_THRESHOLD = 6;
const TOUCH_LONG_PRESS_MS = 250;
const TOUCH_CANCEL_MOVE = 10;
const AUTO_SCROLL_EDGE = 56;

export const dropKey = (t: DropTarget | null) => (t ? `${t.kind}:${t.value}` : '');

function findDropTarget(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const zone = el?.closest('[data-drop-kind]') as HTMLElement | null;
  if (!zone) return null;
  const kind = zone.dataset.dropKind as DropKind | undefined;
  const value = zone.dataset.dropValue;
  if (!kind || !value) return null;
  return { kind, value };
}

/** 指・カーソルの下にあるスクロール可能な要素を探す（なければメインの表示領域） */
function findScrollContainers(x: number, y: number): HTMLElement[] {
  const result: HTMLElement[] = [];
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const style = window.getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) result.push(el);
    el = el.parentElement;
  }
  const main = document.getElementById('view-panel-viewport');
  if (main && !result.includes(main)) result.push(main);
  return result;
}

export function useTaskDrag(onDrop: (taskId: string, target: DropTarget) => void) {
  const [visual, setVisual] = useState<DragVisual | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const stateRef = useRef<DragState | null>(null);
  const suppressClickUntil = useRef(0);
  const lastDragEndedAt = useRef(0);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const scrollRaf = useRef<number | null>(null);

  const stopAutoScroll = () => {
    if (scrollRaf.current !== null) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = null;
  };

  const autoScrollTick = useCallback(() => {
    const s = stateRef.current;
    if (!s || !s.active) {
      scrollRaf.current = null;
      return;
    }
    for (const c of findScrollContainers(s.x, s.y)) {
      const rect = c.getBoundingClientRect();
      let dy = 0;
      if (s.y < rect.top + AUTO_SCROLL_EDGE) dy = -Math.ceil((rect.top + AUTO_SCROLL_EDGE - s.y) / 4);
      else if (s.y > rect.bottom - AUTO_SCROLL_EDGE) dy = Math.ceil((s.y - (rect.bottom - AUTO_SCROLL_EDGE)) / 4);
      if (dy !== 0) {
        const before = c.scrollTop;
        c.scrollTop += dy;
        if (c.scrollTop !== before) {
          setOver(findDropTarget(s.x, s.y));
          break;
        }
      }
    }
    scrollRaf.current = requestAnimationFrame(autoScrollTick);
  }, []);

  const activate = () => {
    const s = stateRef.current;
    if (!s) return;
    s.active = true;
    s.timer = null;
    document.body.classList.add('task-dragging');
    setVisual({ taskId: s.taskId, title: s.title, x: s.x, y: s.y });
    setOver(findDropTarget(s.x, s.y));
    try {
      navigator.vibrate?.(15);
    } catch {
      // ignore
    }
    if (scrollRaf.current === null) scrollRaf.current = requestAnimationFrame(autoScrollTick);
  };

  const move = (x: number, y: number) => {
    const s = stateRef.current;
    if (!s) return;
    s.x = x;
    s.y = y;
    if (s.active) {
      setVisual({ taskId: s.taskId, title: s.title, x, y });
      setOver(findDropTarget(x, y));
    }
  };

  const finish = (drop: boolean) => {
    const s = stateRef.current;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.cleanup();
    stateRef.current = null;
    stopAutoScroll();
    document.body.classList.remove('task-dragging');
    if (s.active) {
      suppressClickUntil.current = Date.now() + 400;
      lastDragEndedAt.current = Date.now();
      const target = drop ? findDropTarget(s.x, s.y) : null;
      setVisual(null);
      setOver(null);
      if (target) onDropRef.current(s.taskId, target);
    }
  };

  useEffect(() => () => {
    const s = stateRef.current;
    if (s) {
      if (s.timer) clearTimeout(s.timer);
      s.cleanup();
    }
    stopAutoScroll();
    document.body.classList.remove('task-dragging');
  }, []);

  const startMouse = (e: React.MouseEvent, taskId: string, title: string) => {
    if (e.button !== 0 || stateRef.current) return;
    if ((e.target as HTMLElement).closest(NO_DRAG_SELECTOR)) return;
    const onMove = (ev: MouseEvent) => {
      const s = stateRef.current;
      if (!s) return;
      if (!s.active && Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) >= MOUSE_THRESHOLD) {
        s.x = ev.clientX;
        s.y = ev.clientY;
        activate();
      }
      if (s.active) {
        ev.preventDefault();
        move(ev.clientX, ev.clientY);
      }
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    stateRef.current = {
      taskId,
      title,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      timer: null,
      cleanup: () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('keydown', onKey);
      },
    };
  };

  const startTouch = (e: React.TouchEvent, taskId: string, title: string) => {
    if (e.touches.length !== 1 || stateRef.current) return;
    if ((e.target as HTMLElement).closest(NO_DRAG_SELECTOR)) return;
    const t = e.touches[0];
    const onMove = (ev: TouchEvent) => {
      const s = stateRef.current;
      if (!s) return;
      const p = ev.touches[0];
      if (!p) return;
      if (!s.active) {
        if (Math.hypot(p.clientX - s.startX, p.clientY - s.startY) > TOUCH_CANCEL_MOVE) {
          // 長押し前に動いた → ふつうのスクロールとして扱う
          finish(false);
        }
        return;
      }
      if (ev.cancelable) ev.preventDefault();
      move(p.clientX, p.clientY);
    };
    const onEnd = (ev: TouchEvent) => {
      const s = stateRef.current;
      if (s?.active && ev.cancelable) ev.preventDefault();
      finish(ev.type === 'touchend');
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: false });
    document.addEventListener('touchcancel', onEnd, { passive: false });
    stateRef.current = {
      taskId,
      title,
      startX: t.clientX,
      startY: t.clientY,
      x: t.clientX,
      y: t.clientY,
      active: false,
      timer: setTimeout(activate, TOUCH_LONG_PRESS_MS),
      cleanup: () => {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
      },
    };
  };

  /** ドラッグできるタスク要素に付ける props */
  const bind = (taskId: string, title: string) => ({
    onMouseDown: (e: React.MouseEvent) => startMouse(e, taskId, title),
    onTouchStart: (e: React.TouchEvent) => startTouch(e, taskId, title),
    onClickCapture: (e: React.MouseEvent) => {
      if (Date.now() < suppressClickUntil.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (stateRef.current) e.preventDefault();
    },
    'data-drag-task': taskId,
  });

  /** タブ切替スワイプなどと競合しないよう、ドラッグ中・直後かどうか */
  const isDragBusy = () => !!stateRef.current?.active || Date.now() - lastDragEndedAt.current < 500 || (!!stateRef.current && !stateRef.current.active && !!stateRef.current.timer);

  return { bind, visual, over, isDragBusy };
}
