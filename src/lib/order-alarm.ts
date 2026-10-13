/**
 * Browser-only order sounds: the Kitchen single beep and the repeating
 * dashboard New Order Alarm. Settings are stored on this device only.
 */

const SETTINGS_KEY = "flamio.order-alarm.v1";
const NEW_ORDER_ALARM_URL = "/sounds/new-order-alarm.mp3";

export type OrderAlarmSettings = { enabled: boolean; volume: number; intervalSec: number };
export const DEFAULT_ALARM_SETTINGS: OrderAlarmSettings = { enabled: true, volume: 0.6, intervalSec: 3 };

export function readAlarmSettings(): OrderAlarmSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_ALARM_SETTINGS, ...JSON.parse(raw) } : DEFAULT_ALARM_SETTINGS;
  } catch {
    return DEFAULT_ALARM_SETTINGS;
  }
}

export function writeAlarmSettings(settings: OrderAlarmSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new Event("flamio-order-alarm-settings"));
  } catch {
    /* storage unavailable */
  }
}

let shared: AudioContext | null = null;
let alarmBuffer: AudioBuffer | null = null;
let alarmBufferRequest: Promise<AudioBuffer> | null = null;

function context(): AudioContext | null {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!shared) shared = new Ctx();
  return shared;
}

function loadAlarmBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  if (alarmBuffer) return Promise.resolve(alarmBuffer);
  if (!alarmBufferRequest) {
    alarmBufferRequest = fetch(NEW_ORDER_ALARM_URL)
      .then((response) => {
        if (!response.ok) throw new Error("New order alarm audio unavailable");
        return response.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((decoded) => {
        alarmBuffer = decoded;
        return decoded;
      })
      .catch((error) => {
        alarmBufferRequest = null;
        throw error;
      });
  }
  return alarmBufferRequest;
}

/** Call from a tap/click so later sounds are allowed to play. */
export async function unlockAudio(): Promise<boolean> {
  try {
    const ctx = context();
    if (!ctx) return false;
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state === "running") await loadAlarmBuffer(ctx);
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export function isAudioUnlocked(): boolean {
  return shared?.state === "running";
}

const activeAlarmSources = new Set<AudioBufferSourceNode>();
const activeAlarmGains = new Set<GainNode>();
let alarmPlaybackGeneration = 0;

/** Kitchen's original short beep (own context, same sound as before). */
export function beep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => void ctx.close();
  } catch {
    /* autoplay restrictions — visual indicator still shows */
  }
}

/** One alarm burst using the locally bundled reference tune. */
export function playAlarmOnce(volume: number) {
  const ctx = context();
  if (!ctx || ctx.state !== "running") return;
  const generation = alarmPlaybackGeneration;
  void loadAlarmBuffer(ctx).then((buffer) => {
    if (ctx.state !== "running" || generation !== alarmPlaybackGeneration) return;
    stopActiveAlarmTones();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.min(Math.max(volume, 0), 1);
    source.connect(gain).connect(ctx.destination);
    activeAlarmSources.add(source);
    activeAlarmGains.add(gain);
    source.onended = () => {
      activeAlarmSources.delete(source);
      activeAlarmGains.delete(gain);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }).catch(() => {
    /* unavailable or blocked — the banner still shows */
  });
}

function stopActiveAlarmTones() {
  const now = shared?.currentTime ?? 0;
  for (const gain of activeAlarmGains) {
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.001, now);
    } catch {
      /* node may already have ended */
    }
  }
  for (const source of activeAlarmSources) {
    try {
      source.stop(now);
    } catch {
      /* node may already have ended */
    }
  }
  activeAlarmSources.clear();
  activeAlarmGains.clear();
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAlarm(volume: number, intervalSec: number) {
  stopAlarm();
  playAlarmOnce(volume);
  timer = setInterval(() => {
    if (document.visibilityState === "visible") playAlarmOnce(volume);
  }, Math.max(intervalSec, 1) * 1000);
}

export function stopAlarm() {
  alarmPlaybackGeneration += 1;
  if (timer) clearInterval(timer);
  timer = null;
  stopActiveAlarmTones();
}
