let shared: AudioContext | null = null;

function context() {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  shared ??= new AudioCtx();
  return shared;
}

export function primeSoldSound() {
  const ctx = context();
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

export function playSoldSound() {
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(220, now);
  thud.frequency.exponentialRampToValueAtTime(55, now + 0.16);
  thudGain.gain.setValueAtTime(0.0001, now);
  thudGain.gain.exponentialRampToValueAtTime(0.45, now + 0.015);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  thud.connect(thudGain).connect(ctx.destination);
  thud.start(now);
  thud.stop(now + 0.3);

  const length = Math.floor(ctx.sampleRate * 0.12);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const noise = ctx.createBufferSource();
  const noiseGain = ctx.createGain();
  noise.buffer = buffer;
  noiseGain.gain.setValueAtTime(0.22, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  noise.connect(noiseGain).connect(ctx.destination);
  noise.start(now);
}

export function playBuzzSound() {
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const buzz = ctx.createOscillator();
  const gain = ctx.createGain();
  buzz.type = "square";
  buzz.frequency.setValueAtTime(180, now);
  buzz.frequency.setValueAtTime(140, now + 0.12);
  buzz.frequency.setValueAtTime(190, now + 0.24);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  buzz.connect(gain).connect(ctx.destination);
  buzz.start(now);
  buzz.stop(now + 0.56);
}
