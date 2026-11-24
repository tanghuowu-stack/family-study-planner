/**
 * 家长设备判断（docs/TASK_09_points.md §7）：家长操作只在 Mac（非触摸设备）上提供，iPad、手机上没有。
 *
 * 用 navigator.maxTouchPoints 判断，不看 User-Agent：iPadOS 的 Safari 默认把自己标识成 Mac（"桌面版网站"），
 * 只看 UA 会把 iPad 当成 Mac。Mac 的 maxTouchPoints 是 0，iPad / 手机大于 0。
 * 不用"长按 2 秒"区分家长——孩子同样可以长按。
 */
export function isTouchDevice(nav: { maxTouchPoints?: number } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return (nav?.maxTouchPoints ?? 0) > 0;
}

/** 这台设备能不能做家长操作（补记过去日期、家长奖励、确认 / 兑换愿望、改练习分值） */
export const isParentDevice = () => !isTouchDevice();
