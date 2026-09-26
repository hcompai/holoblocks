import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, GALLERY, type BuildSummary } from "./api";
import { BlocksPanel } from "./BlocksPanel";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { Gallery } from "./Gallery";
import { LibraryPanel } from "./LibraryPanel";
import { ThemeToggle } from "./ThemeToggle";
import { Timeline } from "./Timeline";
import { useBuild } from "./useBuild";
import { type Framing, ViewControls, Viewer } from "./Viewer";
import type { VoxelWorld } from "./voxels";

const STEP_MS = 900;

function initialBuildId(): string | null {
  return new URLSearchParams(window.location.search).get("build");
}

export default function App() {
  const [buildId, setBuildId] = useState<string | null>(initialBuildId);
  const { build, thinking, renderRequest } = useBuild(buildId);
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [left, setLeft] = useState<"chat" | "library">(GALLERY ? "library" : "chat");
  const [center, setCenter] = useState<"model" | "blocks" | "code">("model");
  const [step, setStep] = useState(Infinity);
  const [following, setFollowing] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [world, setWorld] = useState<VoxelWorld | null>(null);
  const [blockCount, setBlockCount] = useState(0);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [spin, setSpin] = useState(false);
  const palette = useMemo(() => api.palette(), []);
  const last = (build?.steps.length ?? 0) - 1;

  const refreshBuilds = useCallback(() => {
    api.builds().then(setBuilds);
  }, []);

  useEffect(refreshBuilds, [refreshBuilds, build?.status, left]);

  const open = useCallback((id: string | null) => {
    setBuildId(id);
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("build", id);
    else url.searchParams.delete("build");
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    if (following) setStep(last);
  }, [following, last]);

  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      setFollowing(true);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, speed, step, last]);

  const scrub = (s: number) => {
    setPlaying(false);
    setStep(s);
    setFollowing(s >= last);
  };

  const create = async (prompt: string, builder: string) => {
    const created = await api.create(prompt, builder);
    open(created.id);
    setLeft("chat");
    refreshBuilds();
  };

  const onWorld = useCallback((w: VoxelWorld | null) => {
    setWorld(w);
    let n = 0;
    if (w) for (const c of w.counts().values()) n += c;
    setBlockCount(n);
  }, []);

  const visibleStep = following ? last : Math.min(step, last);
  const summary = builds.find((b) => b.id === buildId);

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => open(null)}>
          <img className="brand-logo" src="/logo.png" alt="" />
          Blockyard
        </button>
        {build && (
          <>
            <span className="title">{build.name}</span>
            <span className="chip">{blockCount.toLocaleString()} blocks</span>
            <span className="chip">{build.steps.length} steps</span>
            <span className="chip">
              {build.width}×{build.depth} site
            </span>
          </>
        )}
        <span className="spacer" />
        <ThemeToggle />
        {build && (
          <>
            <a className="button primary" href={api.downloadUrl(build.id)} download={`${build.name}.schem`}>
              <DownloadSimpleIcon size={16} weight="bold" />
              Download .schem
            </a>
          </>
        )}
      </header>
      <aside>
        <div className="tabs">
          <button className={left === "chat" ? "active" : ""} onClick={() => setLeft("chat")}>
            Chat
          </button>
          <button className={left === "library" ? "active" : ""} onClick={() => setLeft("library")}>
            Library
          </button>
        </div>
        {left === "chat" ? (
          <ChatPanel
            build={build}
            thinking={thinking}
            onCreate={create}
            onSay={(text) => build && api.say(build.id, text)}
          />
        ) : (
          <LibraryPanel
            builds={builds}
            activeId={buildId}
            onOpen={(id) => {
              open(id);
              if (!GALLERY) setLeft("chat");
            }}
          />
        )}
      </aside>
      <main>
        {!buildId && <Gallery builds={builds} onOpen={open} />}
        <div className={buildId ? "workspace" : "workspace hidden"}>
          <div className="stage-head">
            <div className="tabs">
              <button className={center === "model" ? "active" : ""} onClick={() => setCenter("model")}>
                Model
              </button>
              <button className={center === "code" ? "active" : ""} disabled={!build} onClick={() => setCenter("code")}>
                Code
              </button>
              <button className={center === "blocks" ? "active" : ""} disabled={!build} onClick={() => setCenter("blocks")}>
                Blocks
              </button>
            </div>
            {center === "model" && <ViewControls framing={framing} spin={spin} onFrame={setFraming} onSpin={setSpin} />}
          </div>
          <div className="stage">
            <div className={center === "model" ? "pane" : "pane hidden"}>
              <Viewer
                build={build}
                step={visibleStep}
                framing={framing}
                spin={spin}
                hasThumbnail={summary && !!summary.thumbnail}
                renderRequest={renderRequest}
                palette={palette}
                onWorld={onWorld}
              />
            </div>
            {center === "blocks" && build && (
              <div className="pane">
                <BlocksPanel world={world} palette={palette} />
              </div>
            )}
            {center === "code" && build && (
              <div className="pane">
                <CodePanel build={build} step={visibleStep} onStep={scrub} />
              </div>
            )}
          </div>
          <Timeline
            build={build}
            step={visibleStep}
            playing={playing}
            speed={speed}
            onStep={scrub}
            onPlay={(p) => {
              setFollowing(false);
              setPlaying(p);
            }}
            onSpeed={setSpeed}
          />
        </div>
      </main>
    </div>
  );
}
