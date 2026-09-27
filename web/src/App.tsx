import { PlusIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, GALLERY, type BuildSummary } from "./api";
import { BlockLoader } from "./BlockLoader";
import { BlocksPanel } from "./BlocksPanel";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { DownloadMenu } from "./DownloadMenu";
import { Gallery } from "./Gallery";
import { LibraryPanel } from "./LibraryPanel";
import { ThemeToggle } from "./ThemeToggle";
import { Timeline } from "./Timeline";
import type { BlockScene } from "./scene";
import { useBuild } from "./useBuild";
import { type Framing, RenderFailed, ViewControls, Viewer } from "./Viewer";

const STEP_MS = 900;
const TITLE = document.title;
const CENTER_TABS = [
  { id: "model", label: "Model" },
  { id: "code", label: "Code" },
  { id: "blocks", label: "Blocks" },
] as const;

function urlBuildId(): string | null {
  return new URLSearchParams(window.location.search).get("build");
}

export default function App() {
  const [buildId, setBuildId] = useState<string | null>(urlBuildId);
  const { build, thinking, renderRequest, error } = useBuild(buildId);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState(false);
  const [left, setLeft] = useState<"chat" | "library">(GALLERY ? "library" : "chat");
  const [center, setCenter] = useState<(typeof CENTER_TABS)[number]["id"]>("model");
  const [step, setStep] = useState(Infinity);
  const [following, setFollowing] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [blockCount, setBlockCount] = useState(0);
  const [renderFailed, setRenderFailed] = useState(false);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [spin, setSpin] = useState(false);
  const palette = useMemo(() => api.palette(), []);
  const scene = useRef<BlockScene | null>(null);
  const last = (build?.steps.length ?? 0) - 1;

  const refreshBuilds = useCallback(() => {
    setBuildsFailed(false);
    api.builds().then(setBuilds, (e) => {
      console.error(e);
      setBuildsFailed(true);
    });
  }, []);

  useEffect(refreshBuilds, [refreshBuilds]);

  const summary = builds?.find((b) => b.id === buildId);
  const heading = build ?? summary;

  useEffect(() => {
    if (build && builds && summary?.status !== build.status) refreshBuilds();
  }, [build?.id, build?.status, summary?.status]);

  useEffect(() => {
    document.title = buildId && heading ? heading.name : TITLE;
  }, [buildId, heading?.name]);

  const show = useCallback((id: string | null) => {
    setBuildId(id);
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
  }, []);

  const open = useCallback(
    (id: string | null) => {
      show(id);
      if (id === urlBuildId()) return;
      const url = new URL(window.location.href);
      if (id) url.searchParams.set("build", id);
      else url.searchParams.delete("build");
      window.history.pushState(null, "", url);
    },
    [show],
  );

  useEffect(() => {
    const sync = () => show(urlBuildId());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [show]);

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

  const create = async (prompt: string, builder: string, images: string[]) => {
    const created = await api.create(prompt, builder, images);
    open(created.id);
    setLeft("chat");
  };

  const onCounts = useCallback((c: Map<string, number> | null) => {
    setCounts(c);
    let n = 0;
    if (c) for (const k of c.values()) n += k;
    setBlockCount(n);
  }, []);

  const visibleStep = following ? last : Math.min(step, last);
  const hasBlocks = (build ? build.boxes.length : (summary?.boxes ?? 0)) > 0;
  const opening = `Opening ${heading?.name ?? "the build"}`;

  const downloadImage = async () => {
    const png = await scene.current?.image();
    if (!png || !heading) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(png);
    link.download = `${heading.name}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href));
  };

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => open(null)}>
          <img className="brand-logo" src="/logo.png" alt="" />
          Blockyard
        </button>
        {buildId && heading && !error && (
          <>
            <span className="title" title={heading.name}>
              {heading.name}
            </span>
            {counts ? (
              <span className="chip">{blockCount.toLocaleString()} blocks</span>
            ) : (
              !renderFailed && <span className="chip pending" />
            )}
            <span className="chip">{build?.steps.length ?? summary?.steps} steps</span>
            <span className="chip">
              {heading.width}×{heading.depth} site
            </span>
          </>
        )}
        <span className="spacer" />
        <ThemeToggle />
        {buildId && heading && !error && hasBlocks && (
          <DownloadMenu name={heading.name} schemUrl={api.downloadUrl(buildId)} onImage={downloadImage} />
        )}
      </header>
      <aside>
        <div className="aside-head">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={left === "chat"}
              className={left === "chat" ? "active" : ""}
              onClick={() => setLeft("chat")}
            >
              Chat
            </button>
            <button
              role="tab"
              aria-selected={left === "library"}
              className={left === "library" ? "active" : ""}
              onClick={() => setLeft("library")}
            >
              Library
            </button>
          </div>
          {buildId && !GALLERY && (
            <button
              className="new-build"
              onClick={() => {
                open(null);
                setLeft("chat");
              }}
            >
              <PlusIcon size={14} weight="bold" />
              New build
            </button>
          )}
        </div>
        {left === "library" && (
          <LibraryPanel
            builds={builds}
            failed={buildsFailed}
            onRetry={refreshBuilds}
            activeId={buildId}
            onOpen={open}
          />
        )}
        <ChatPanel
          buildId={buildId}
          build={build}
          loadFailed={!!error}
          thinking={thinking}
          hidden={left !== "chat"}
          onCreate={create}
        />
      </aside>
      <main>
        {!buildId && <Gallery builds={builds} failed={buildsFailed} onRetry={refreshBuilds} onOpen={open} />}
        <div className={buildId ? "workspace" : "workspace hidden"}>
          <div className="stage-head">
            <div className="tabs" role="tablist">
              {CENTER_TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={center === t.id}
                  className={center === t.id ? "active" : ""}
                  disabled={t.id !== "model" && !build}
                  onClick={() => setCenter(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {center === "model" && !error && (
              <ViewControls framing={framing} spin={spin} onFrame={setFraming} onSpin={setSpin} />
            )}
          </div>
          <div className="stage">
            <div className={center === "model" ? "pane" : "pane hidden"}>
              <Viewer
                build={build}
                step={visibleStep}
                framing={framing}
                spin={spin}
                thumbnailFresh={
                  builds && build ? summary?.thumbnail != null && summary.thumbnail >= build.updated * 1000 : undefined
                }
                onThumbnail={refreshBuilds}
                renderRequest={renderRequest}
                palette={palette}
                onCounts={onCounts}
                scene={scene}
                loading={buildId && !counts && !error ? opening : null}
                failed={renderFailed}
                onFailed={setRenderFailed}
              />
              {build && !build.boxes.length && build.status !== "building" && (
                <div className="notice">Nothing built yet</div>
              )}
            </div>
            {center !== "model" && (
              <div className="pane">
                {center === "code" && build ? (
                  <CodePanel build={build} step={visibleStep} onStep={scrub} />
                ) : center === "blocks" && counts ? (
                  <BlocksPanel counts={counts} palette={palette} />
                ) : center === "blocks" && renderFailed ? (
                  <RenderFailed />
                ) : (
                  !error && <BlockLoader label={opening} />
                )}
              </div>
            )}
            {error && (
              <div className="pane notice" role="alert">
                <b>{error}</b>
                <button onClick={() => open(null)}>Back to library</button>
              </div>
            )}
          </div>
          {!error && (
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
          )}
        </div>
      </main>
    </div>
  );
}
