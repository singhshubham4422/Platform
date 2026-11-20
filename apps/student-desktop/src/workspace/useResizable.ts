import type React from 'react';
import { useCallback, useRef, useState } from 'react';

/** Pointer + keyboard resizable split. Ratio is the size of the first (x) or second (y) pane. */
export function useResizable({ initial, min, max, axis, storageKey }: { initial: number; min: number; max: number; axis: 'x' | 'y'; storageKey: string }) {
  const [ratio, setRatioState] = useState<number>(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored >= min && stored <= max ? stored : initial;
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setRatio = useCallback(
    (r: number) => {
      const clamped = Math.min(max, Math.max(min, r));
      setRatioState(clamped);
      localStorage.setItem(storageKey, String(clamped));
    },
    [max, min, storageKey],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (axis === 'x') setRatio((ev.clientX - rect.left) / rect.width);
      else setRatio(1 - (ev.clientY - rect.top) / rect.height);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('ws-resizing');
    };
    document.body.classList.add('ws-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 0.03;
    if (axis === 'x' && e.key === 'ArrowLeft') setRatio(ratio - step);
    if (axis === 'x' && e.key === 'ArrowRight') setRatio(ratio + step);
    if (axis === 'y' && e.key === 'ArrowUp') setRatio(ratio + step);
    if (axis === 'y' && e.key === 'ArrowDown') setRatio(ratio - step);
  };

  return { ratio, containerRef, handleProps: { onPointerDown, onKeyDown } };
}
