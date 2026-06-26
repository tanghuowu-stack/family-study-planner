import { useEffect, useRef } from "react";

/**
 * Follow-hand swipe gesture with animated completion or snap-back.
 *
 * Attaches touch listeners to the returned ref element.
 * - touchmove: content translates with finger (direct DOM, no React re-renders)
 * - touchend: if threshold/velocity met → animate off-screen then fire onLeft/onRight
 *             otherwise → spring back to origin
 *
 * touchmove is non-passive so we can preventDefault() to lock vertical scroll
 * once a horizontal swipe is confirmed.
 */
export function useSwipe<T extends HTMLElement>(
  onLeft: () => void,
  onRight: () => void,
  options: { threshold?: number; velocityThreshold?: number } = {},
) {
  const { threshold = 72, velocityThreshold = 0.3 } = options;
  const ref = useRef<T>(null);
  const cbs = useRef({ onLeft, onRight });
  cbs.current = { onLeft, onRight };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    // null = undecided, 'h' = horizontal locked, 'v' = vertical locked
    let direction: "h" | "v" | null = null;

    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = Date.now();
      direction = null;
      // Kill any running transition so the element snaps to finger immediately
      el.style.transition = "none";
    };

    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      // Wait until movement is large enough to judge direction
      if (!direction) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        direction = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
      }

      if (direction === "v") return; // let vertical scroll pass through

      // Confirmed horizontal — block scroll and follow the finger
      e.preventDefault();

      // Rubber-band damping: resistance increases as drag grows
      const w = window.innerWidth;
      const damped = dx * Math.max(0.15, 1 - Math.abs(dx) / (w * 2.5));
      el.style.transform = `translateX(${damped}px)`;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (direction !== "h") {
        direction = null;
        return;
      }
      direction = null;

      const dx = e.changedTouches[0].clientX - startX;
      const dt = Math.max(1, Date.now() - startTime);
      const velocity = Math.abs(dx) / dt; // px/ms

      if (Math.abs(dx) > threshold || velocity > velocityThreshold) {
        // --- Complete the swipe: fly off-screen then navigate ---
        const targetX = dx > 0 ? window.innerWidth : -window.innerWidth;
        el.style.transition = "transform 220ms ease-in";
        el.style.transform = `translateX(${targetX}px)`;

        const nav = dx < 0 ? cbs.current.onLeft : cbs.current.onRight;
        setTimeout(() => {
          // Reset before React re-renders the new content at position 0
          el.style.transition = "none";
          el.style.transform = "";
          nav();
        }, 220);
      } else {
        // --- Snap back to origin ---
        el.style.transition =
          "transform 320ms cubic-bezier(0.25, 0.46, 0.45, 0.94)";
        el.style.transform = "translateX(0)";
        // Clean up after animation
        setTimeout(() => {
          el.style.transform = "";
          el.style.transition = "";
        }, 320);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // Non-passive: we need to call preventDefault() to suppress vertical scroll
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return ref;
}
