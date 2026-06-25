import { useEffect, useRef } from "react";

/**
 * Attaches touchstart/touchend listeners to the returned ref element.
 * Fires onLeft when horizontal swipe left (|dx| > threshold && |dx| > |dy|).
 * Fires onRight for right swipe. Passive listeners — no scroll interference.
 */
export function useSwipe<T extends HTMLElement>(
  onLeft: () => void,
  onRight: () => void,
  threshold = 50,
) {
  const ref = useRef<T>(null);
  const cbs = useRef({ onLeft, onRight });
  cbs.current = { onLeft, onRight };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) cbs.current.onLeft();
        else cbs.current.onRight();
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return ref;
}
