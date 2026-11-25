import { useEffect, useState } from "react";

/** iPad（非电脑布局、宽 ≥640）：页面一屏放下的布局（同 index.css 的 .fit-tablet） */
/** 电脑布局（同 tailwind 的 desk 断点）：宽 ≥1024 且有鼠标 / 触控板 */
export const DESK_QUERY = "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

export const TABLET_FIT_QUERY = "(min-width: 640px) and (max-width: 1023px), (min-width: 640px) and (hover: none), (min-width: 640px) and (pointer: coarse)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}
