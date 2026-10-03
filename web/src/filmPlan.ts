import type { Box, Build } from "./model";
import { CAMERA_MOVE_SECONDS } from "./buildTiming";

export const HOLO_MODEL = "HOLO4";

export const FILM_ASPECTS = {
  "16:9": { label: "Landscape · 16:9", width: 1920, height: 1080 },
  "1:1": { label: "Square · 1:1", width: 1080, height: 1080 },
  "9:16": { label: "Portrait · 9:16", width: 1080, height: 1920 },
};
export type FilmAspect = keyof typeof FILM_ASPECTS;
export const FILM_SECONDS = [8, 12, 20, 30];
export const MIN_SECONDS = 6;
export const MAX_SECONDS = 60;
export type FilmCamera = "follow" | "orbit" | "fixed";

export interface FilmOptions {
  width: number;
  height: number;
  seconds: number;
  fps: number;
  /** The H Company logo in the corner. */
  branded: boolean;
  camera?: FilmCamera;
}

const INTRO_S = 0.4;
const HOLD_S = 1;

/** A build step that places or clears blocks, with the layers its boxes span. */
export interface FilmStepBoxes {
  index: number;
  title: string;
  boxes: Box[];
  volume: number;
  /** Its lowest layer, and one past its highest. */
  bottom: number;
  top: number;
}

export interface FilmStep extends Omit<FilmStepBoxes, "boxes" | "volume"> {
  /** Its 1-based position among the steps that have boxes. */
  number: number;
  /** When it starts and finishes rising, in seconds. */
  start: number;
  end: number;
}

export interface FilmPlan {
  seconds: number;
  steps: FilmStep[];
  /** When the last step has risen and the turntable starts. */
  assembled: number;
  /** When the turntable ends and the final hold starts. */
  hold: number;
}

export const frameCount = (options: Pick<FilmOptions, "seconds" | "fps">) => Math.round(options.seconds * options.fps);

/** The steps that have boxes, in step order. */
export function filmSteps(build: Pick<Build, "boxes" | "steps">): FilmStepBoxes[] {
  const groups = new Map<number, FilmStepBoxes>();
  const titles = new Map(build.steps.map((s) => [s.index, s.title]));
  for (const b of build.boxes) {
    let group = groups.get(b.step);
    if (!group) {
      const title = titles.get(b.step) ?? `Step ${b.step + 1}`;
      groups.set(b.step, (group = { index: b.step, title, boxes: [], volume: 0, bottom: Infinity, top: -Infinity }));
    }
    group.boxes.push(b);
    group.volume += (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1) * (b.z1 - b.z0 + 1);
    group.bottom = Math.min(group.bottom, b.y0);
    group.top = Math.max(group.top, b.y1 + 1);
  }
  return [...groups.values()].sort((a, b) => a.index - b.index);
}

/**
 * Steps rise layer by layer, with brief camera moves between steps. Each gets time by the cube root of its
 * volume, its size along a side, so a whole terrain rises quickly and a single block still gets a beat.
 */
export function planFilm(build: Pick<Build, "boxes" | "steps">, seconds: number): FilmPlan {
  if (!build.boxes.length) throw new Error("Nothing to film: the build has no blocks.");
  if (!(seconds >= MIN_SECONDS && seconds <= MAX_SECONDS)) {
    throw new Error(`Films last ${MIN_SECONDS} to ${MAX_SECONDS} seconds.`);
  }
  const turntable = Math.min(Math.max(seconds * 0.25, 2.5), 6);
  const hold = seconds - HOLD_S;
  const assembled = hold - turntable;
  const groups = filmSteps(build);
  const weights = groups.map((g) => Math.cbrt(g.volume));
  const total = weights.reduce((a, b) => a + b, 0);
  const move = Math.min(CAMERA_MOVE_SECONDS, ((assembled - INTRO_S) * 0.2) / Math.max(groups.length - 1, 1));
  const placement = assembled - INTRO_S - move * (groups.length - 1);
  let time = INTRO_S;
  const steps = groups.map(({ index, title, bottom, top }, i) => {
    if (i) time += move;
    const window = (placement * weights[i]) / total;
    const step = { index, title, bottom, top, number: i + 1, start: time, end: time + window };
    time += window;
    return step;
  });
  return { seconds, steps, assembled, hold };
}

/** The planned step rising at `time`, -1 before the first, and how many of its layers are up: all of them once it ends. */
export function rising(plan: FilmPlan, time: number): { step: number; layers: number } {
  let step = -1;
  while (step + 1 < plan.steps.length && plan.steps[step + 1].start <= time) step++;
  if (step < 0) return { step, layers: 0 };
  const { start, end, bottom, top } = plan.steps[step];
  const layers = top - bottom;
  if (time >= end) return { step, layers };
  return { step, layers: Math.min(Math.max(Math.ceil(((time - start) / (end - start)) * layers), 1), layers) };
}

export function filmFilename(name: string, extension: string): string {
  const safe = name
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 100)
    .trim();
  return `${safe || "holoblocks"}-build.${extension}`;
}

export function filmCaption(build: Pick<Build, "name" | "status">, blocks: number | null, branded: boolean): string {
  const count = blocks === null ? "" : `: ${blocks.toLocaleString("en-US")} Minecraft blocks`;
  const author = branded ? `${HOLO_MODEL} by H Company` : "HoloBlocks";
  const state = build.status === "building" ? " · work in progress" : "";
  const tags = branded ? `#${HOLO_MODEL} #HoloBlocks #Minecraft` : "#HoloBlocks #Minecraft";
  return `${build.name}${count}, built with ${author}${state}. ${tags}`;
}
