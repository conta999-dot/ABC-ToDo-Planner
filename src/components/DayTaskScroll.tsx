import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * v0.6.8: 日付カードの中のタスク一覧。カード内でスクロールし、下に隠れている件数を「▼ あとN件」で表示する。
 * スマホ幅（カードがスクロールしない）では隠れた行がないので何も出さない。
 */
export function DayTaskScroll({ className, children, id }: { className: string; children: React.ReactNode; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);
  const [moreBelow, setMoreBelow] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (el.scrollHeight <= el.clientHeight + 1) {
      setHidden(0);
      setMoreBelow(false);
      return;
    }
    setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    let n = 0;
    el.querySelectorAll<HTMLElement>('[id^="task-row-"]').forEach((row) => {
      const r = row.getBoundingClientRect();
      if (r.height > 0 && r.bottom > box.bottom + 2) n++;
    });
    setHidden(n);
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div ref={ref} className={`${className} relative`} onScroll={measure} id={id}>
      {children}
      {(hidden > 0 || moreBelow) && (
        <div
          className="sticky bottom-0 -mt-1 pt-3 pb-0.5 text-center text-[0.75rem] font-black text-sky-700 dark:text-sky-300 bg-gradient-to-b from-transparent to-white to-50% dark:to-zinc-900 pointer-events-none"
          data-more-indicator
        >
          {hidden > 0 ? `▼ スクロールで あと${hidden}件` : '▼ スクロールで続き'}
        </div>
      )}
    </div>
  );
}
