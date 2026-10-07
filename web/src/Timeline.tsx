import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from "@phosphor-icons/react";
import { type CSSProperties, useEffect } from "react";
import type { Build } from "./model";

export const SPEEDS = [0.5, 1, 2, 4];

interface Props {
  build: Build | null;
  step: number;
  playing: boolean;
  speed: number;
  onStep: (step: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  /** Return to the newest step and follow incoming revisions after scrubbing. */
  onLive?: () => void;
  /** How many blocks the shown step has, once counted. */
  blocks: number | null;
  /** Whether Space plays and pauses; walking takes Space to jump and fly. */
  spaceKey: boolean;
}

export function Timeline({ build, step, playing, speed, onStep, onPlay, onSpeed, onLive, blocks, spaceKey }: Props) {
  const steps = build?.steps ?? [];
  const last = steps.length - 1;
  const current = Math.min(step, last);
  const failed = build?.status === "error" && current === last;
  const finished = build?.status === "done" && steps.length > 0 && current === last;
  const label = !build
    ? "Loading…"
    : !steps.length
      ? "No steps yet"
      : failed
        ? "Stopped with an error"
        : finished
          ? "Finished model"
          : current < 0
            ? "Empty canvas"
            : `Step ${current + 1} of ${steps.length}: ${steps[current]?.title ?? ""}`;

  const toggle = () => {
    if (!playing && current >= last) onStep(-1);
    onPlay(!playing);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!spaceKey) return;
      if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !steps.length) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, button, a, [contenteditable]"))
        return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="timeline">
      <button className="icon" disabled={!steps.length} onClick={() => onStep(0)} title="First step">
        <SkipBackIcon size={16} weight="fill" />
      </button>
      <button className="play" disabled={!steps.length} onClick={toggle} title={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
      </button>
      <button className="icon" disabled={current >= last} onClick={() => onStep(last)} title="Last step">
        <SkipForwardIcon size={16} weight="fill" />
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} className={s === speed ? "active" : ""} aria-pressed={s === speed} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      {onLive && (
        <button className="timeline-live" onClick={onLive}>
          Live
        </button>
      )}
      <div className="scrub">
        <div className="scrub-label">
          <b>{label}</b>
          {build && (
            <span>
              {blocks !== null && `${blocks.toLocaleString()} blocks · `}
              {current + 1}/{steps.length} steps
            </span>
          )}
        </div>
        <input
          type="range"
          aria-label="Step"
          min={-1}
          max={Math.max(last, 0)}
          value={Math.max(current, -1)}
          disabled={!steps.length}
          onChange={(e) => onStep(Number(e.target.value))}
          style={{ "--fill": `${steps.length ? ((current + 1) / steps.length) * 100 : 0}%` } as CSSProperties}
        />
      </div>
    </div>
  );
}
