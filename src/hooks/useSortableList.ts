import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * 列表拖拽排序（2026-11-14，替代浏览器自带的 HTML5 拖放）。
 *
 * 以前用 draggable + dragover/drop：iPad/手机上基本拖不动（要长按、还常被当成滚动），
 * 拖的时候其他行不让位、只在目标行上画一条线，松手后还要等写库（云端模式要等上传）再整页重读，顺序才变。
 * 现在：
 * - 只能从拖动手柄开始（手柄 touch-action:none，按住即拖，页面其他地方照常滚动）；
 * - 被拖的那一行跟着手指/鼠标走，其他行实时让位（带过渡动画）；
 * - 靠近屏幕上下边缘自动滚动；Esc 或系统打断（pointercancel）取消；
 * - 松手立刻按新顺序显示（乐观更新），写库在后台进行，完成后以库里的顺序为准；
 * - 松手时被拖的那一行从手指位置平滑落到新位置（FLIP）；
 * - 手柄可用键盘 ↑/↓ 移动一格。
 */
export interface SortableList<T extends string> {
  /** 当前应显示的顺序（拖拽中/写库中为乐观顺序） */
  order: T[];
  draggingId: T | null;
  itemProps: (id: T) => { ref: (node: HTMLElement | null) => void; style: CSSProperties; "data-dragging"?: true };
  handleProps: (id: T) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    style: CSSProperties;
    "data-no-swipe": true;
  };
}

interface DragState<T> {
  id: T;
  from: number;
  over: number;
  offset: number;
}

const EDGE = 80; // 距离视口上下边缘多少 px 内开始自动滚动
const MAX_SPEED = 14; // 每帧最多滚动多少 px

const moveItem = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/** 根据被拖那一项中心点的位置，算出它该落在第几位 */
export function overIndexFor(rects: { top: number; height: number }[], from: number, offset: number): number {
  const center = rects[from].top + rects[from].height / 2 + offset;
  let index = 0;
  rects.forEach((rect, i) => { if (i !== from && rect.top + rect.height / 2 < center) index++; });
  return index;
}

/** 拖拽中其余各项该让多少位：落点经过的那些项让出被拖那一项的高度 */
export function shiftFor(i: number, from: number, over: number, draggedHeight: number): number {
  if (i === from) return 0;
  if (from < over && i > from && i <= over) return -draggedHeight;
  if (over < from && i >= over && i < from) return draggedHeight;
  return 0;
}

export function useSortableList<T extends string>(ids: T[], onCommit: (ids: T[]) => void | Promise<void>, enabled = true): SortableList<T> {
  const [optimistic, setOptimistic] = useState<T[] | null>(null);
  const [drag, setDragState] = useState<DragState<T> | null>(null);
  // 拖拽状态同时放一份在 ref 里：事件回调里读最新值，且不在 setState 的更新函数里做副作用
  // （开发模式 StrictMode 会把更新函数执行两次，提交写库会重复）
  const dragRef = useRef<DragState<T> | null>(null);
  const setDrag = (next: DragState<T> | null) => { dragRef.current = next; setDragState(next); };
  const nodes = useRef(new Map<T, HTMLElement>());
  const rects = useRef<{ top: number; height: number }[]>([]);
  const session = useRef<{ startY: number; startScroll: number; pointerY: number; raf: number; cleanup: () => void } | null>(null);
  const settle = useRef<{ id: T; fromTop: number } | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const idsKey = ids.join("|");
  // 乐观顺序只在成员一致时生效；列表成员变了（增删任务）就以传入为准
  const order = optimistic && optimistic.length === ids.length && optimistic.every((id) => ids.includes(id)) ? optimistic : ids;
  const orderRef = useRef(order);
  orderRef.current = order;

  useEffect(() => { if (optimistic && optimistic.join("|") === idsKey) setOptimistic(null); }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback((next: T[]) => {
    setOptimistic(next);
    void Promise.resolve(commitRef.current(next)).catch(() => undefined).finally(() => setOptimistic(null));
  }, []);

  const finish = useCallback((cancelled: boolean) => {
    const s = session.current;
    if (!s) return;
    s.cleanup();
    session.current = null;
    const current = dragRef.current;
    if (current && !cancelled && current.over !== current.from) {
      const node = nodes.current.get(current.id);
      if (node) settle.current = { id: current.id, fromTop: node.getBoundingClientRect().top };
      commit(moveItem(orderRef.current, current.from, current.over));
    }
    setDrag(null);
  }, [commit]); // eslint-disable-line react-hooks/exhaustive-deps

  // 松手后被拖那一行从手指位置平滑落到新位置
  useLayoutEffect(() => {
    const pending = settle.current;
    if (!pending || drag) return;
    settle.current = null;
    const node = nodes.current.get(pending.id);
    if (!node) return;
    const delta = pending.fromTop - node.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) return;
    node.style.transition = "none";
    node.style.transform = `translateY(${delta}px)`;
    void node.offsetHeight;
    node.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
    node.style.transform = "";
    const clear = () => { node.style.transition = ""; node.removeEventListener("transitionend", clear); };
    node.addEventListener("transitionend", clear);
  });

  useEffect(() => () => session.current?.cleanup(), []);

  const update = useCallback(() => {
    const s = session.current;
    if (!s) return;
    const current = dragRef.current;
    if (!current) return;
    const offset = s.pointerY - s.startY + (window.scrollY - s.startScroll);
    setDrag({ ...current, offset, over: overIndexFor(rects.current, current.from, offset) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (id: T, event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || session.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    const from = orderRef.current.indexOf(id);
    if (from < 0 || orderRef.current.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    rects.current = orderRef.current.map((key) => {
      const rect = nodes.current.get(key)?.getBoundingClientRect();
      return { top: (rect?.top ?? 0) + window.scrollY, height: rect?.height ?? 0 };
    });
    const handle = event.currentTarget;
    try { handle.setPointerCapture(event.pointerId); } catch { /* 旧浏览器不支持时退回到 window 监听 */ }

    const onMove = (e: PointerEvent) => { if (session.current) { session.current.pointerY = e.clientY; update(); } };
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(true); };
    // 靠近上下边缘自动滚动（底部留出导航栏的位置）
    const tick = () => {
      const s = session.current;
      if (!s) return;
      const bottomEdge = window.innerHeight - EDGE - (window.innerWidth < 1024 ? 64 : 0);
      const speed = s.pointerY < EDGE ? -Math.ceil(((EDGE - s.pointerY) / EDGE) * MAX_SPEED)
        : s.pointerY > bottomEdge ? Math.ceil(((s.pointerY - bottomEdge) / EDGE) * MAX_SPEED) : 0;
      if (speed) { window.scrollBy(0, speed); update(); }
      s.raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    const previousSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    session.current = {
      startY: event.clientY, startScroll: window.scrollY, pointerY: event.clientY, raf: requestAnimationFrame(tick),
      cleanup: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        document.body.style.userSelect = previousSelect;
        if (session.current) cancelAnimationFrame(session.current.raf);
      },
    };
    setDrag({ id, from, over: from, offset: 0 });
  };

  const onKeyDown = (id: T, event: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const from = orderRef.current.indexOf(id);
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    if (from < 0 || to < 0 || to >= orderRef.current.length) return;
    event.preventDefault();
    commit(moveItem(orderRef.current, from, to));
  };

  return {
    order,
    draggingId: drag?.id ?? null,
    itemProps: (id) => {
      const ref = (node: HTMLElement | null) => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); };
      if (!drag) return { ref, style: {} };
      const i = order.indexOf(id);
      if (id === drag.id) {
        return {
          ref, "data-dragging": true,
          style: { transform: `translateY(${drag.offset}px) scale(1.015)`, transition: "box-shadow 150ms", position: "relative", zIndex: 30, boxShadow: "0 12px 28px rgba(32, 41, 37, 0.18)", background: "white", borderRadius: 8 },
        };
      }
      const shift = shiftFor(i, drag.from, drag.over, rects.current[drag.from]?.height ?? 0);
      return { ref, style: { transform: shift ? `translateY(${shift}px)` : undefined, transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)" } };
    },
    handleProps: (id) => ({
      onPointerDown: (event) => startDrag(id, event),
      onKeyDown: (event) => onKeyDown(id, event),
      style: { touchAction: "none", cursor: drag?.id === id ? "grabbing" : "grab" },
      "data-no-swipe": true,
    }),
  };
}
