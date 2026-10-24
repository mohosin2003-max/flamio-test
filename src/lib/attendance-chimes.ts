/**
 * Attendance audio chimes. Short synthesized tones (no audio files).
 * Fail-safe: any audio problem is swallowed and never blocks a punch.
 */
export type ChimeKind = "clock_in" | "clock_out" | "break" | "warning" | "queued";
export const CHIME_MUTE_KEY = "flamio_attendance_chime_muted";

export interface PrefStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function isChimeMuted(store: PrefStore | null | undefined): boolean {
  try { return store?.getItem(CHIME_MUTE_KEY) === "1"; } catch { return false; }
}
export function setChimeMuted(store: PrefStore | null | undefined, muted: boolean): void {
  try { store?.setItem(CHIME_MUTE_KEY, muted ? "1" : "0"); } catch { /* storage unavailable */ }
}

export const CHIME_NOTES: Record<ChimeKind, number[]> = {
  clock_in: [660, 880],
  clock_out: [880, 660],
  break: [740],
  warning: [440, 440],
  queued: [520],
};

type AudioCtor = new () => { currentTime: number; destination: unknown; createOscillator(): any; createGain(): any; close?: () => Promise<void> };

/** Returns true when a chime was scheduled; false when muted or audio unavailable. */
export function playChime(kind: ChimeKind, opts: { store?: PrefStore | null; Audio?: AudioCtor | null } = {}): boolean {
  try {
    if (isChimeMuted(opts.store)) return false;
    const Ctor = opts.Audio ?? (typeof window !== "undefined" ? ((window as any).AudioContext ?? (window as any).webkitAudioContext) : null);
    if (!Ctor) return false;
    const ctx = new Ctor();
    const notes = CHIME_NOTES[kind];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.16;
      osc.type = kind === "warning" ? "square" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.16);
    });
    setTimeout(() => { void ctx.close?.().catch(() => {}); }, notes.length * 200 + 200);
    return true;
  } catch {
    return false;
  }
}
