/**
 * 完成音效：Web Audio 合成两个上行短音，不引外部资源。
 * iPad Safari 自动播放限制：AudioContext 在首次用户手势的调用里懒创建并 resume，
 * 因此 playCompletionSound 必须从点击/触摸事件处理器同步调用（await 之前）。
 */
const SOUND_KEY = "familyPlanner.completionSound";

export const isSoundEnabled = () => localStorage.getItem(SOUND_KEY) !== "off";
export const setSoundEnabled = (on: boolean) => localStorage.setItem(SOUND_KEY, on ? "on" : "off");

let ctx: AudioContext | null = null;

export function playCompletionSound(): void {
  if (!isSoundEnabled()) return;
  try {
    type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const notes: [number, number][] = [[880, 0], [1174.66, 0.09]]; // A5 → D6
    for (const [freq, offset] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.16, t + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.2);
    }
  } catch {
    // 音效失败不影响任务操作
  }
}
