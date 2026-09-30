import { PlusIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create, say, stop, unavailable } from "./agent";
import { BlockLoader } from "./BlockLoader";
import { BlocksPanel } from "./BlocksPanel";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { DownloadMenu } from "./DownloadMenu";
import { Gallery } from "./Gallery";
import { LibraryPanel } from "./LibraryPanel";
import { library, remember, thumbnail } from "./library";
import { PALETTE, type BuildSummary } from "./model";
import type { BlockScene } from "./scene";
import { schematic } from "./schematic";
import { ThemeToggle } from "./ThemeToggle";
import { Timeline } from "./Timeline";
import { type BuildRef, useBuild } from "./useBuild";
import { type Framing, RenderFailed, ViewControls, Viewer } from "./Viewer";

const STEP_MS = 900;
const TITLE = document.title;
const CENTER_TABS = [
  { id: "model", label: "Model" },
  { id: "code", label: "Code" },
  { id: "blocks", label: "Blocks" },
] as const;

function urlRef(): BuildRef | null {
  const params = new URLSearchParams(window.location.search);
  const showcase = params.get("showcase");
  const build = params.get("build");
  return showcase ? { id: showcase, showcase: true } : build ? { id: build, showcase: false } : null;
}

const sameRef = (a: BuildRef | null, b: BuildRef | null) => a?.id === b?.id && a?.showcase === b?.showcase;

function save(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href));
}

export default function App() {
  const [ref, setRef] = useState<BuildRef | null>(urlRef);
  const buildId = ref?.id ?? null;
  const { build, thinking, renderRequest, error, syncError, answer } = useBuild(ref);
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState(false);
  const [left, setLeft] = useState<"chat" | "library">(unavailable ? "library" : "chat");
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
  const palette = useMemo(() => Promise.resolve(PALETTE), []);
  const scene = useRef<BlockScene | null>(null);
  const last = (build?.steps.length ?? 0) - 1;

  const refreshBuilds = useCallback(() => {
    setBuildsFailed(false);
    library().then(setBuilds, (e) => {
      console.error(e);
      setBuildsFailed(true);
    });
  }, []);

  useEffect(refreshBuilds, [refreshBuilds]);

  const summary = builds?.find((b) => b.id === buildId && b.showcase === ref?.showcase);
  const name = build?.name ?? summary?.name;

  useEffect(() => {
    if (build && builds && summary?.status !== build.status) refreshBuilds();
  }, [build?.id, build?.status, summary?.status]);

  useEffect(() => {
    document.title = buildId && name ? name : TITLE;
  }, [buildId, name]);

  const show = useCallback((next: BuildRef | null) => {
    setRef(next);
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
  }, []);

  const open = useCallback(
    (next: BuildRef | null) => {
      show(next);
      if (sameRef(next, urlRef())) return;
      const url = new URL(window.location.href);
      url.searchParams.delete("build");
      url.searchParams.delete("showcase");
      if (next) url.searchParams.set(next.showcase ? "showcase" : "build", next.id);
      window.history.pushState(null, "", url);
    },
    [show],
  );

  useEffect(() => {
    const sync = () => show(urlRef());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [show]);

  useEffect(() => {
    if (following) setStep(last);
  }, [following, last]);

  useEffect(() => {
    if (!renderRequest) return;
    setPlaying(false);
    setFollowing(true);
  }, [renderRequest?.request]);

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

  const openListed = (id: string) => open({ id, showcase: !!builds?.find((b) => b.id === id)?.showcase });

  const scrub = (s: number) => {
    setPlaying(false);
    setStep(s);
    setFollowing(s >= last);
  };

  const start = async (prompt: string, images: string[]) => {
    const id = await create(prompt, images);
    remember(id, { prompt });
    open({ id, showcase: false });
    setLeft("chat");
    refreshBuilds();
  };

  const saveThumbnail = async (png: Blob) => {
    if (!ref || ref.showcase) return;
    remember(ref.id, { thumbnail: await thumbnail(png) });
    refreshBuilds();
  };

  const onCounts = useCallback((c: Map<string, number> | null) => {
    setCounts(c);
    let n = 0;
    if (c) for (const k of c.values()) n += k;
    setBlockCount(n);
  }, []);

  const closed =
    unavailable ??
    (ref?.showcase
      ? "A showcase from the gallery. Start a new build to make your own."
      : build && !build.open && build.status !== "building"
        ? "This build's session has ended. Start a new build to make another."
        : null);
  const visibleStep = following ? last : Math.min(step, last);
  const hasBlocks = !!build?.boxes.length;
  const opening = `Opening ${name ?? "the build"}`;

  const downloadImage = async () => {
    const png = await scene.current?.image();
    if (png && build) save(png, `${build.name}.png`);
  };

  const downloadSchem = async () => {
    if (build) save(await schematic(build), `${build.name}.schem`);
  };

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => open(null)}>
          <img className="brand-logo" src="/logo.png" alt="" />
          Blockyard
        </button>
        {buildId && name && !error && (
          <span className="title" title={name}>
            {name}
          </span>
        )}
        {build && !error && (
          <>
            {counts ? (
              <span className="chip">{blockCount.toLocaleString()} blocks</span>
            ) : (
              !renderFailed && <span className="chip pending" />
            )}
            <span className="chip">{build.steps.length} steps</span>
            <span className="chip">
              {build.width}×{build.depth} site
            </span>
            {syncError && (
              <span className="chip warn" role="status" title={syncError}>
                Reconnecting…
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        <ThemeToggle />
        {build && !error && hasBlocks && <DownloadMenu onSchem={downloadSchem} onImage={downloadImage} />}
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
          {buildId && !unavailable && (
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
            onOpen={openListed}
          />
        )}
        <ChatPanel
          buildId={buildId}
          build={build}
          loadFailed={!!error}
          thinking={thinking}
          hidden={left !== "chat"}
          closed={closed}
          onCreate={start}
          onSay={(text, images) => say(buildId!, text, images)}
          onStop={async () => void (await stop(buildId!))}
        />
      </aside>
      <main>
        {!buildId && (
          <Gallery
            closed={unavailable}
            builds={builds}
            failed={buildsFailed}
            onRetry={refreshBuilds}
            onOpen={openListed}
          />
        )}
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
                renderRequest={renderRequest}
                onRender={answer}
                onThumbnail={saveThumbnail}
                syncError={syncError}
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
