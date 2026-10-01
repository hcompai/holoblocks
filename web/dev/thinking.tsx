import { useEffect, useMemo, useRef, useState } from "react";
import { PHASES, THINKING_PHASES } from "../src/activity";
import { ChatPanel } from "../src/ChatPanel";
import { useEdits } from "../src/edits";
import { type Build, PALETTE } from "../src/model";
import type { BlockScene } from "../src/scene";
import { ThemeToggle } from "../src/ThemeToggle";
import { PlacementSoundToggle } from "../src/PlacementSound";
import { Viewer } from "../src/Viewer";
import type { Reference } from "../src/session";
import gatehouse from "./references/harlech-gatehouse.jpg";
import walls from "./references/harlech-walls.jpg";
import stairwell from "./references/harlech-stairwell.jpg";

const STAGES = Object.values(PHASES);
const palette = Promise.resolve(PALETTE);
const framing = { view: "iso" as const };
const noop = () => {};
const sampleReferences: Reference[] = [
  { id: "reference-1", src: walls, caption: "Harlech · stone towers", kind: "photo" },
  { id: "reference-2", src: gatehouse, caption: "Harlech · archway", kind: "photo" },
  { id: "reference-3", src: stairwell, caption: "Harlech · stairwell", kind: "photo" },
];

/** A local preview uses the production components and an illustrative model, without an account or API calls. */
export default function Preview() {
  const [phase, setPhase] = useState(0);
  const [automatic, setAutomatic] = useState(true);
  const [hasBlocks, setHasBlocks] = useState(false);
  const [done, setDone] = useState(false);
  const [prompt, setPrompt] = useState("A stone tower with a garden");
  const [since, setSince] = useState(Date.now);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [references, setReferences] = useState<Reference[]>([]);
  const [photoRun, setPhotoRun] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const scene = useRef<BlockScene | null>(null);
  const build = useMemo<Build>(
    () => ({
      id: "thinking-preview",
      name: prompt,
      width: 32,
      depth: 32,
      height: 32,
      updated: 0,
      revision: hasBlocks ? "preview-tower" : "",
      steps: hasBlocks
        ? [
            { index: 0, title: "Garden", code: "" },
            { index: 1, title: "Tower", code: "" },
          ]
        : [],
      boxes: hasBlocks
        ? [
            { x0: 8, y0: 0, z0: 8, x1: 23, y1: 0, z1: 23, block: "grass_block", step: 0 },
            { x0: 14, y0: 1, z0: 8, x1: 17, y1: 1, z1: 13, block: "gravel", step: 0 },
            { x0: 12, y0: 1, z0: 14, x1: 19, y1: 1, z1: 21, block: "cobblestone", step: 1 },
            { x0: 13, y0: 2, z0: 15, x1: 18, y1: 9, z1: 20, block: "stone_bricks", step: 1 },
            { x0: 15, y0: 2, z0: 14, x1: 16, y1: 4, z1: 14, block: "oak_planks", step: 1 },
            { x0: 12, y0: 10, z0: 14, x1: 19, y1: 10, z1: 21, block: "stone_bricks", step: 1 },
            { x0: 12, y0: 11, z0: 14, x1: 13, y1: 12, z1: 15, block: "stone_bricks", step: 1 },
            { x0: 18, y0: 11, z0: 14, x1: 19, y1: 12, z1: 15, block: "stone_bricks", step: 1 },
            { x0: 12, y0: 11, z0: 20, x1: 13, y1: 12, z1: 21, block: "stone_bricks", step: 1 },
            { x0: 18, y0: 11, z0: 20, x1: 19, y1: 12, z1: 21, block: "stone_bricks", step: 1 },
          ]
        : [],
      status: done ? "done" : "building",
      open: true,
      messages: [
        { role: "user", text: prompt, images: [] },
        ...(done
          ? [
              {
                role: "assistant" as const,
                text: "Preview finished. Restart to try the thinking state again.",
                images: [],
              },
            ]
          : []),
      ],
    }),
    [hasBlocks, done, prompt],
  );
  const edits = useEdits(build);
  const activity = { label: STAGES[phase], since, work: null, references, title };

  useEffect(() => setSince(Date.now()), [phase]);
  useEffect(() => {
    if (phase !== 2 || hasBlocks || done) return;
    setReferences([]);
    const timers = sampleReferences.map((reference, index) =>
      setTimeout(() => setReferences((previous) => [...previous, reference]), 800 + index * 900),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, photoRun, hasBlocks, done]);
  useEffect(() => {
    if (phase !== 3 || hasBlocks || done) return;
    setTitle(null);
    const timer = setTimeout(() => setTitle("The Keeper’s Garden"), 1300);
    return () => clearTimeout(timer);
  }, [phase, hasBlocks, done]);
  useEffect(() => {
    if (!automatic || done) return;
    const timer = setInterval(() => setPhase((previous) => (previous + 1) % THINKING_PHASES.length), 8000);
    return () => clearInterval(timer);
  }, [automatic, done]);

  const restart = async (text = prompt) => {
    setPrompt(text);
    setPhase(0);
    setSince(Date.now());
    setHasBlocks(false);
    setDone(false);
    setAutomatic(true);
    setReferences([]);
    setTitle(null);
  };
  const stop = async () => {
    setAutomatic(false);
    setDone(true);
  };

  return (
    <div className="app thinking-preview">
      <header>
        <span className="brand">
          <img className="brand-logo" src="/logo.png" alt="" /> HoloBlocks
        </span>
        <span className="chip">Thinking preview</span>
        <span className="spacer" />
        <ThemeToggle />
        <PlacementSoundToggle />
      </header>
      <aside>
        <div className="aside-body">
          <p className="preview-note">Local demo · Illustrative activity, no live build.</p>
          <ChatPanel
            buildId={build.id}
            build={build}
            loadFailed={false}
            activity={activity}
            closed={null}
            onCreate={restart}
            onSay={restart}
            onRemix={restart}
            onStop={stop}
          />
        </div>
      </aside>
      <main>
        <div className="stage-head">
          <strong>{build.name}</strong>
          <span className="muted small">Model preview</span>
        </div>
        <div className="stage">
          <div className="pane">
            <Viewer
              build={build}
              step={step}
              framing={framing}
              spin={false}
              onThumbnail={noop}
              palette={palette}
              onCounts={noop}
              scene={scene}
              loading={null}
              thinking={!hasBlocks && !done ? activity : null}
              placementSpeed={speed}
              failed={failed}
              onFailed={setFailed}
              mode="view"
              edits={edits}
              onMode={noop}
            />
            {done && !hasBlocks && <div className="notice">Preview stopped. Press Restart below.</div>}
          </div>
        </div>
        <div className="preview-controls">
          <div className="preview-subject">
            <label htmlFor="preview-request">What are we building?</label>
            <input id="preview-request" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </div>
          <div className="preview-phases" aria-label="Thinking stages">
            {THINKING_PHASES.map((label, index) => (
              <button
                key={label}
                aria-pressed={phase === index}
                className={phase === index ? "active" : ""}
                onClick={() => {
                  setPhase(index);
                  setAutomatic(false);
                  setDone(false);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="preview-actions">
            <button aria-pressed={automatic} onClick={() => setAutomatic(!automatic)}>
              Auto-cycle: {automatic ? "on" : "off"}
            </button>
            <button
              onClick={() => {
                setHasBlocks(!hasBlocks);
                setPhase(4);
                setDone(false);
                setAutomatic(false);
              }}
            >
              {hasBlocks ? "Hide model" : "Show first model"}
            </button>
            <button onClick={stop}>Finish build</button>
            <button onClick={() => restart()}>Restart</button>
            <button
              onClick={() => {
                setHasBlocks(false);
                setPhase(2);
                setDone(false);
                setAutomatic(false);
                setPhotoRun((run) => run + 1);
              }}
            >
              Replay photo arrivals
            </button>
            {hasBlocks && (
              <>
                <button onClick={() => scene.current?.show(build, step, { animate: true, reset: true })}>
                  Replay placement
                </button>
                <button onClick={() => setStep(0)}>Garden step</button>
                <button onClick={() => setStep(1)}>Tower step</button>
              </>
            )}
            <label>
              Speed{" "}
              <select
                aria-label="Placement speed"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {[0.5, 1, 2, 4].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          {references.length > 0 && (
            <p className="preview-credit">
              Sample photos:{" "}
              <a href="https://commons.wikimedia.org/wiki/File:Harlech_Castle_(1).jpg" target="_blank" rel="noreferrer">
                GeraintTudur2 / Wikimedia Commons
              </a>{" "}
              ·{" "}
              <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">
                CC BY-SA 3.0
              </a>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
