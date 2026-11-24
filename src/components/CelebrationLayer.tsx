import { useMemo } from "react";
import type { Celebration } from "../data/pointsService";

/** 散花只用现有配色（style.md §2） */
const PETAL_COLORS = ["#2B7656", "#DCEAE3", "#E36B4E", "#EFC66A"];

/**
 * 中档庆祝（2026-11-24）：少量散花 + 一句提示，点一下消失。不加声音；
 * 散花 1.6 秒内落完，提示卡片停在那里等点。prefers-reduced-motion 下不散花。
 * 一次只显示队列里的第一个，点掉再显示下一个。
 */
export function CelebrationLayer({ queue, onDismiss }: { queue: Celebration[]; onDismiss: () => void }) {
  const current = queue[0];
  const petals = useMemo(() => {
    if (!current) return [];
    const count = 14;
    return Array.from({ length: count }, (_, index) => ({
      left: 10 + ((index * 37) % 80) + Math.random() * 6,
      drift: (Math.random() - 0.5) * 120,
      rotate: (Math.random() - 0.5) * 540,
      delay: Math.random() * 250,
      duration: 1100 + Math.random() * 450,
      size: 6 + Math.random() * 5,
      color: PETAL_COLORS[index % PETAL_COLORS.length],
      round: index % 3 === 0,
    }));
  }, [current?.id]);
  if (!current) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/20 p-6" onClick={onDismiss} role="presentation">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
        {petals.map((petal, index) => (
          <span key={index} className={`absolute top-[-12px] ${petal.round ? "rounded-full" : "rounded-sm"}`}
            style={{ left: `${petal.left}%`, width: petal.size, height: petal.size * (petal.round ? 1 : 1.6), background: petal.color, animation: `petal-fall ${petal.duration}ms ease-in ${petal.delay}ms forwards`, ["--drift" as string]: `${petal.drift}px`, ["--spin" as string]: `${petal.rotate}deg`, opacity: 0 }} />
        ))}
      </div>
      <button type="button" role="status" aria-live="polite" onClick={onDismiss}
        className={`relative max-w-sm animate-[celebrate_500ms_ease-out] rounded-lg border border-ink/10 bg-white shadow-xl px-6 py-5 text-center motion-reduce:animate-none`}>
        <span className="block text-lg font-bold text-ink">{current.title}</span>
        {current.detail && <span className="mt-1.5 block text-[15px] leading-6 text-muted">{current.detail}</span>}
        <span className="mt-3 block text-[13px] text-stone-400">点一下关闭</span>
      </button>
    </div>
  );
}
