import { replayDelay } from "../src/buildTiming";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import "@fontsource-variable/fira-code";
import "@fontsource-variable/plus-jakarta-sans";
import "../src/styles.css";
import "./camera.css";
import { FilmExport } from "../src/FilmExport";
import { useEdits } from "../src/edits";
import { type Box, type Build, PALETTE } from "../src/model";
import { type BlockScene } from "../src/scene";
import { ThemeToggle } from "../src/ThemeToggle";
import { Timeline } from "../src/Timeline";
import { Viewer, ViewControls, type Framing, type Mode } from "../src/Viewer";

const palette = Promise.resolve(PALETTE);
const noop = () => {};
const box = (
  step: number,
  block: string,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): Box => ({ step, block, x0, y0, z0, x1, y1, z1 });
const samples = {
  Tower: {
    titles: ["Garden", "Courtyard", "Stone walls", "Upper tower", "Battlements", "Gatehouse"],
    boxes: [
      box(0, "grass_block", 6, 0, 6, 33, 0, 33),
      box(1, "stone_bricks", 11, 1, 11, 28, 1, 28),
      box(2, "stone_bricks", 15, 2, 17, 24, 10, 17),
      box(2, "stone_bricks", 15, 2, 26, 24, 10, 26),
      box(2, "stone_bricks", 15, 2, 18, 15, 10, 25),
      box(2, "stone_bricks", 24, 2, 18, 24, 10, 25),
      box(3, "stone_bricks", 16, 11, 18, 23, 21, 18),
      box(3, "stone_bricks", 16, 11, 25, 23, 21, 25),
      box(3, "stone_bricks", 16, 11, 19, 16, 21, 24),
      box(3, "stone_bricks", 23, 11, 19, 23, 21, 24),
      box(4, "stone_bricks", 15, 22, 17, 24, 22, 26),
      ...[15, 19, 23].flatMap((x) => [
        box(4, "stone_bricks", x, 23, 17, x + 1, 24, 18),
        box(4, "stone_bricks", x, 23, 25, x + 1, 24, 26),
      ]),
      box(5, "oak_planks", 8, 2, 10, 12, 5, 15),
      box(5, "dark_oak_planks", 7, 6, 9, 13, 6, 16),
    ],
  },
  Bridge: {
    titles: ["River", "Abutments", "Piers", "Deck", "Parapets", "Lamps"],
    boxes: [
      box(0, "water", 3, 0, 10, 36, 0, 29),
      box(1, "stone_bricks", 3, 1, 16, 8, 3, 23),
      box(1, "stone_bricks", 31, 1, 16, 36, 3, 23),
      ...[12, 19, 26].map((x) => box(2, "stone_bricks", x, 1, 18, x + 1, 8, 21)),
      box(3, "oak_planks", 3, 9, 17, 36, 9, 22),
      box(4, "stone_bricks", 3, 10, 16, 36, 10, 16),
      box(4, "stone_bricks", 3, 10, 23, 36, 10, 23),
      ...[4, 14, 24, 34].flatMap((x) => [
        box(5, "oak_log", x, 11, 16, x, 13, 16),
        box(5, "glowstone", x, 14, 16, x, 14, 16),
      ]),
    ],
  },
};

/** Account-free preview of the production viewer and export controls. */
function CameraPreview() {
  const [sample, setSample] = useState<keyof typeof samples>("Tower");
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [followCamera, setFollowCamera] = useState(true);
  const [spin, setSpin] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const scene = useRef<BlockScene | null>(null);
  const build = useMemo<Build>(
    () => ({
      id: `camera-${sample}`,
      name: sample === "Tower" ? "The Keeper’s Garden" : "River Crossing",
      width: 40,
      height: 40,
      depth: 40,
      revision: sample,
      updated: 0,
      status: "done",
      open: false,
      messages: [],
      boxes: samples[sample].boxes,
      steps: samples[sample].titles.map((title, index) => ({ title, index, code: "" })),
    }),
    [sample],
  );
  const edits = useEdits(build);
  useEffect(() => {
    if (!playing || placing || exporting || mode !== "view") return;
    if (step >= build.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), replayDelay(step, speed));
    return () => clearTimeout(timer);
  }, [playing, placing, exporting, mode, step, speed, build]);

  return (
    <div className="app camera-preview">
      <header>
        <span className="brand">
          <img className="brand-logo" src="/logo.png" alt="" /> HoloBlocks
        </span>
        <span className="chip">Camera preview</span>
        <select
          aria-label="Sample build"
          value={sample}
          onChange={(e) => {
            setSample(e.target.value as keyof typeof samples);
            setStep(-1);
            setPlaying(true);
            setFollowCamera(true);
            setSpin(false);
          }}
        >
          {Object.keys(samples).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <span className="spacer" />
        <button
          onClick={() => {
            setStep(-1);
            setPlaying(true);
            setFollowCamera(true);
            setSpin(false);
          }}
        >
          Replay
        </button>
        <button onClick={() => setExporting(true)}>Share a GIF…</button>
        <ThemeToggle />
      </header>
      <main>
        <div className="stage-head">
          <strong>{build.name}</strong>
          <ViewControls
            framing={framing}
            spin={spin}
            followCamera={followCamera && mode === "view"}
            onFollowCamera={(follow) => {
              setFollowCamera(follow);
              if (follow) setSpin(false);
            }}
            mode={mode}
            canEdit={false}
            built={step >= 0}
            onFrame={(next) => {
              setFollowCamera(false);
              setFraming(next);
            }}
            onSpin={(next) => {
              setFollowCamera(false);
              setSpin(next);
            }}
            onMode={(next) => {
              setFollowCamera(false);
              setMode(next);
            }}
          />
        </div>
        <div className="stage">
          <div className="pane">
            <Viewer
              build={build}
              step={step}
              framing={framing}
              spin={spin}
              followCamera={followCamera}
              onFollowCamera={setFollowCamera}
              onThumbnail={noop}
              palette={palette}
              onCounts={setCounts}
              scene={scene}
              loading={null}
              thinking={null}
              placementSpeed={speed}
              onPlacing={setPlacing}
              failed={failed}
              onFailed={setFailed}
              mode={mode}
              edits={edits}
              onMode={setMode}
            />
          </div>
        </div>
        <Timeline
          build={build}
          step={step}
          playing={playing}
          speed={speed}
          onStep={(next) => {
            setPlaying(false);
            setStep(next);
          }}
          onPlay={setPlaying}
          onSpeed={setSpeed}
          blocks={counts ? [...counts.values()].reduce((a, b) => a + b, 0) : null}
          spaceKey={mode !== "walk"}
        />
      </main>
      {exporting && <FilmExport build={build} onClose={() => setExporting(false)} />}
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<CameraPreview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
