import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Celebration } from "../data/pointsService";
import { CONFETTI_COLORS, CONFETTI_RADIUS } from "../utils/confetti";

/** 卡片自己停多久（毫秒）再收起；点一下可以提前关 */
export const CELEBRATION_STAY_MS = 4500;

/**
 * 中档庆祝（学校作业全部做完、某项练习达标、本周作业提前完成）：
 * 2026-11-24 用户要求"也要有庆祝散花，停留一下"——
 * - 卡片后面先炸开一圈彩色散花（和打勾得分弹窗同一套颜色、形状），接着从屏幕顶上落下一阵散花，前后约 3.5 秒；
 * - 卡片停 4.5 秒自己收起，点一下提前关。不加声音；prefers-reduced-motion 下不散花。
 * 一次只显示队列里的第一个，收起后再显示下一个。
 */
export function CelebrationLayer({ queue, onDismiss }: { queue: Celebration[]; onDismiss: () => void }) {
  const current = queue[0];
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => dismissRef.current(), CELEBRATION_STAY_MS);
    return () => clearTimeout(timer);
  }, [current?.id]);
  const { burst, rain } = useMemo(() => {
    if (!current) return { burst: [], rain: [] };
    const burst = Array.from({ length: 30 }, (_, index) => {
      const angle = (index / 30) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const distance = [320, 240, 180][index % 3];
      const shape = index % 3;
      const size = [24, 16, 20, 13, 22, 18, 12][index % 7];
      return {
        dx: Math.round(Math.cos(angle) * distance * 1.15), dy: Math.round(Math.sin(angle) * distance * 0.85),
        width: shape === 2 ? Math.round(size * 0.55) : size, height: shape === 2 ? Math.round(size * 1.3) : size,
        radius: CONFETTI_RADIUS[shape], color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        spin: `${(index % 2 ? 1 : -1) * (180 + (index % 5) * 60)}deg`, delay: 60 + (index % 6) * 25,
      };
    });
    const rain = Array.from({ length: 44 }, (_, index) => {
      const shape = index % 3;
      const size = 10 + Math.random() * 10;
      return {
        left: ((index * 23) % 96) + Math.random() * 4,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() - 0.5) * 720,
        delay: 300 + Math.random() * 1300,
        duration: 1900 + Math.random() * 900,
        width: shape === 2 ? size * 0.55 : size, height: shape === 2 ? size * 1.4 : size,
        radius: CONFETTI_RADIUS[shape], color: CONFETTI_COLORS[(index * 4) % CONFETTI_COLORS.length],
      };
    });
    return { burst, rain };
  }, [current?.id]);
  if (!current) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/20 p-6" onClick={onDismiss} role="presentation">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
        {rain.map((piece, index) => (
          <span key={index} className="absolute top-[-24px]"
            style={{ left: `${piece.left}%`, width: piece.width, height: piece.height, borderRadius: piece.radius, background: piece.color, animation: `petal-fall ${piece.duration}ms ease-in ${piece.delay}ms forwards`, "--drift": `${piece.drift}px`, "--spin": `${piece.spin}deg`, opacity: 0 } as CSSProperties} />
        ))}
      </div>
      <div key={current.id} className="relative">
        {/* 卡片后面炸开的一圈散花（同打勾得分弹窗的 points-spark） */}
        <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
          {burst.map((spark, index) => (
            <span key={index} className="absolute left-1/2 top-1/2"
              style={{ width: spark.width, height: spark.height, borderRadius: spark.radius, background: spark.color, "--dx": `${spark.dx}px`, "--dy": `${spark.dy}px`, "--spin": spark.spin, animation: `points-spark 1200ms cubic-bezier(.15,.7,.3,1) ${spark.delay}ms both` } as CSSProperties} />
          ))}
        </div>
        <button type="button" role="status" aria-live="polite" onClick={onDismiss}
          className="relative max-w-sm animate-[celebrate_500ms_ease-out] rounded-lg border border-ink/10 bg-white px-7 py-5 text-center shadow-xl motion-reduce:animate-none">
          <span className="block text-xl font-bold text-ink">{current.title}</span>
          {current.detail && <span className="mt-1.5 block text-[15px] leading-6 text-muted">{current.detail}</span>}
        </button>
      </div>
    </div>
  );
}
