import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Celebration } from "../data/pointsService";
import { CONFETTI_COLORS, CONFETTI_RADIUS } from "../utils/confetti";

/** 卡片自己停多久（毫秒）再收起；点一下可以提前关 */
export const CELEBRATION_STAY_MS = 4500;
/** 卡片飞到页面上那一条（flyTo）用多久 */
const FLY_MS = 700;
/** mini 散花停多久 */
const MINI_MS = 1600;

function makeBurst(count: number, reach: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
    const distance = [reach, reach * 0.75, reach * 0.56][index % 3];
    const shape = index % 3;
    const size = [24, 16, 20, 13, 22, 18, 12][index % 7];
    return {
      dx: Math.round(Math.cos(angle) * distance * 1.15), dy: Math.round(Math.sin(angle) * distance * 0.85),
      width: shape === 2 ? Math.round(size * 0.55) : size, height: shape === 2 ? Math.round(size * 1.3) : size,
      radius: CONFETTI_RADIUS[shape], color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      spin: `${(index % 2 ? 1 : -1) * (180 + (index % 5) * 60)}deg`, delay: 60 + (index % 6) * 25,
    };
  });
}

function Burst({ sparks, duration }: { sparks: ReturnType<typeof makeBurst>; duration: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
      {sparks.map((spark, index) => (
        <span key={index} className="absolute left-1/2 top-1/2"
          style={{ width: spark.width, height: spark.height, borderRadius: spark.radius, background: spark.color, "--dx": `${spark.dx}px`, "--dy": `${spark.dy}px`, "--spin": spark.spin, animation: `points-spark ${duration}ms cubic-bezier(.15,.7,.3,1) ${spark.delay}ms both` } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * 庆祝层（2026-11-24 用户："也要有庆祝散花，停留一下""在中间闪现并散花，之后再把它标到左上角"）：
 * - card（作业全部做完、本周课外作业提前完成、练习达标）：屏幕中间白卡片，后面炸开 30 片彩色散花，
 *   再从屏幕顶上落下 44 片，前后约 3.5 秒；卡片停 4.5 秒（点一下提前）收起。
 *   有 flyTo 的（作业全部做完）收起时缩小飞到今日页上那一条的位置，那一条闪一下；找不到就原地淡出。
 * - mini（本周课外作业勾掉一小项）：屏幕中间"✓ 做完了"小胶囊 + 一圈散花，1.6 秒，不挡点击。
 * 不加声音；prefers-reduced-motion 下不散花、不飞。一次只显示队列里的第一个，收起后再显示下一个。
 */
export function CelebrationLayer({ queue, onDismiss }: { queue: Celebration[]; onDismiss: () => void }) {
  const current = queue[0];
  const mini = current?.kind === "mini";
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const cardRef = useRef<HTMLButtonElement>(null);
  const [fly, setFly] = useState<{ x: number; y: number; scale: number } | "fade" | null>(null);
  const leaving = useRef(false);

  const close = () => {
    if (!current || leaving.current) return;
    leaving.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target = current.flyTo ? document.querySelector<HTMLElement>(current.flyTo) : null;
    const card = cardRef.current;
    if (!reduce && target && card) {
      const from = card.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      setFly({ x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height / 2), scale: Math.max(0.3, Math.min(1, to.width / from.width)) });
      setTimeout(() => {
        target.classList.remove("celebrate-land");
        void target.offsetWidth;
        target.classList.add("celebrate-land");
        setTimeout(() => target.classList.remove("celebrate-land"), 1200);
        dismissRef.current();
      }, FLY_MS);
    } else if (!reduce && !mini) {
      setFly("fade");
      setTimeout(() => dismissRef.current(), 250);
    } else {
      dismissRef.current();
    }
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!current) return;
    leaving.current = false;
    setFly(null);
    const timer = setTimeout(() => closeRef.current(), mini ? MINI_MS : CELEBRATION_STAY_MS);
    return () => clearTimeout(timer);
  }, [current?.id]);

  const { burst, rain } = useMemo(() => {
    if (!current) return { burst: [], rain: [] };
    if (current.kind === "mini") return { burst: makeBurst(22, 240), rain: [] };
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
    return { burst: makeBurst(30, 320), rain };
  }, [current?.id]);

  if (!current) return null;

  if (mini) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center overflow-hidden">
        <div key={current.id} role="status" aria-label={current.title} data-testid="celebration-mini"
          className="points-float relative" style={{ animation: `points-pop ${MINI_MS}ms cubic-bezier(.22,.8,.3,1) forwards` }}>
          <span aria-hidden="true" className="absolute inset-0 rounded-full border-[3px] border-[#F4A3B5]/70" style={{ animation: "points-ring 700ms ease-out 60ms both" }} />
          <Burst sparks={burst} duration={1000} />
          <div className="relative flex items-center gap-2 rounded-full bg-white/95 px-7 py-3 text-3xl font-medium leading-none text-primary shadow-[0_16px_40px_-12px_rgba(43,118,86,0.5)] ring-1 ring-primary/10">
            <Check aria-hidden className="h-8 w-8" strokeWidth={3} />{current.title}
          </div>
        </div>
      </div>
    );
  }

  const flying = fly && fly !== "fade";
  return (
    <div className={`fixed inset-0 z-[90] flex items-center justify-center p-6 transition-colors duration-500 ${fly ? "bg-transparent" : "bg-ink/20"}`} onClick={close} role="presentation">
      <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-300 motion-reduce:hidden ${fly ? "opacity-0" : ""}`}>
        {rain.map((piece, index) => (
          <span key={index} className="absolute top-[-24px]"
            style={{ left: `${piece.left}%`, width: piece.width, height: piece.height, borderRadius: piece.radius, background: piece.color, animation: `petal-fall ${piece.duration}ms ease-in ${piece.delay}ms forwards`, "--drift": `${piece.drift}px`, "--spin": `${piece.spin}deg`, opacity: 0 } as CSSProperties} />
        ))}
      </div>
      <div key={current.id} className="relative"
        style={flying ? { transform: `translate(${fly.x}px, ${fly.y}px) scale(${fly.scale})`, opacity: 0.15, transition: `transform ${FLY_MS}ms cubic-bezier(.5,0,.25,1), opacity ${FLY_MS}ms ease-in` } : fly === "fade" ? { opacity: 0, transition: "opacity 250ms ease-in" } : undefined}>
        <Burst sparks={burst} duration={1200} />
        <button ref={cardRef} type="button" role="status" aria-live="polite" onClick={(event) => { event.stopPropagation(); close(); }}
          className={`relative max-w-sm animate-[celebrate_500ms_ease-out] rounded-lg border px-7 py-5 text-center shadow-xl motion-reduce:animate-none ${current.flyTo ? "border-primary/15 bg-mint" : "border-ink/10 bg-white"}`}>
          <span className={`block text-xl font-bold leading-8 ${current.flyTo ? "text-primary" : "text-ink"}`}>{current.title}</span>
          {current.detail && <span className="mt-1.5 block text-[15px] leading-6 text-muted">{current.detail}</span>}
        </button>
      </div>
    </div>
  );
}
