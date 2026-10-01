/** The audio engine is separate from React and the renderer's off-screen work. */
const KEY = "blockyard.placement-sound";
const listeners = new Set<() => void>();
let enabled = localStorage.getItem(KEY) !== "off";
let context: AudioContext | null = null;
let output: GainNode | null = null;
let last = -Infinity;

/** Short, quiet synthesized pops: material family sets the timbre, block name varies the pitch. */
export function placementPop(block: string) {
  if (!enabled || !context || !output || context.state !== "running" || document.hidden) return;
  const now = context.currentTime;
  // At high placement speeds, one pop per audible beat keeps thousands of blocks from becoming noise.
  if (now - last < 0.055) return;
  last = now;
  let hash = 0;
  for (const character of block) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const wood = /wood|planks|log|bamboo/.test(block);
  const glass = /glass|ice|crystal|lantern/.test(block);
  const soft = /grass|dirt|sand|leaves|wool/.test(block);
  const frequency = (glass ? 680 : wood ? 260 : soft ? 140 : 190) * 2 ** ((hash % 7) / 12);
  const voice = context.createOscillator();
  const envelope = context.createGain();
  voice.type = wood ? "triangle" : "sine";
  voice.frequency.setValueAtTime(frequency * 1.65, now);
  voice.frequency.exponentialRampToValueAtTime(frequency, now + 0.035);
  envelope.gain.setValueAtTime(0.001, now);
  envelope.gain.exponentialRampToValueAtTime(0.18, now + 0.004);
  envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
  voice.connect(envelope).connect(output);
  voice.start(now);
  voice.stop(now + 0.08);
  voice.onended = () => {
    voice.disconnect();
    envelope.disconnect();
  };
}

export const placementSoundEnabled = () => enabled;
export function subscribePlacementSound(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function togglePlacementSound() {
  enabled = !enabled;
  localStorage.setItem(KEY, enabled ? "on" : "off");
  for (const listener of listeners) listener();
  if (enabled) await unlockPlacementSound();
  else if (output && context) output.gain.setValueAtTime(0, context.currentTime);
}

async function unlockPlacementSound() {
  if (!enabled) return;
  context ??= new AudioContext();
  if (!output) {
    output = context.createGain();
    output.connect(context.destination);
  }
  output.gain.value = 0.35;
  await context.resume().catch(() => {});
}

if (enabled) window.addEventListener("pointerdown", () => void unlockPlacementSound(), { once: true });
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void context?.close();
  });
