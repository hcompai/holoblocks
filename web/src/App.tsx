import { PlusIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Account } from "./account";
import { AccountMenu } from "./AccountMenu";
import { create, remix, say, stop } from "./agent";
import { BlockLoader } from "./BlockLoader";
import { BlocksPanel } from "./BlocksPanel";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { CopyLink } from "./CopyLink";
import { DeleteButton } from "./DeleteButton";
import { DownloadMenu } from "./DownloadMenu";
import { useEdits } from "./edits";
import { FilmExport } from "./FilmExport";
import { ImportBuild } from "./ImportBuild";
import { card, library, publish, remember, setPrivate, type Shelf, thumbnail, unpublish } from "./library";
import { LibraryPage } from "./LibraryPage";
import { type Build, type BuildSummary, PALETTE, type Source } from "./model";
import { PublishButton } from "./PublishButton";
import { RecoveryPanel } from "./RecoveryPanel";
import type { BlockScene } from "./scene";
import { schematic } from "./schematic";
import { ThemeToggle } from "./ThemeToggle";
import { Timeline } from "./Timeline";
import { type BuildRef, useBuild } from "./useBuild";
import { useKeeper } from "./useSession";
import { type Framing, type Mode, RenderFailed, ViewControls, Viewer } from "./Viewer";

const STEP_MS = 900;
const TITLE = document.title;
const CENTER_TABS = [
  { id: "model", label: "Model" },
  { id: "code", label: "Code" },
  { id: "blocks", label: "Blocks" },
] as const;
/** The URL parameter naming the open build, by where it is read from. */
const PARAMS: Record<Source, string> = { session: "build", public: "public", showcase: "showcase" };
const LIBRARY = "library";

function urlBuild(): BuildRef | null {
  const params = new URLSearchParams(window.location.search);
  for (const [source, param] of Object.entries(PARAMS) as [Source, string][]) {
    const id = params.get(param);
    if (id) return { id, source };
  }
  return null;
}

const urlLibrary = () => new URLSearchParams(window.location.search).has(LIBRARY);

const linkTo = (ref: BuildRef) => `${window.location.origin}/?${new URLSearchParams({ [PARAMS[ref.source]]: ref.id })}`;

const same = (a: BuildRef | null, b: BuildRef | null) => a?.id === b?.id && a?.source === b?.source;

function save(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href));
}

export default function App({ account }: { account: Account }) {
  const [ref, setRef] = useState<BuildRef | null>(urlBuild);
  const opened = useRef(ref);
  opened.current = ref;
  const [libraryOpen, setLibraryOpen] = useState(urlLibrary);
  const buildId = ref?.id ?? null;
  const { build: live, activity, error, syncError } = useBuild(ref);
  const edits = useEdits(live);
  /** The build as shown, with this browser's hand edits. */
  const build = edits.build;
  const [mode, setMode] = useState<Mode>("view");
  const [builds, setBuilds] = useState<BuildSummary[] | null>(null);
  const [buildsFailed, setBuildsFailed] = useState<Shelf[]>([]);
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
  const [filmBuild, setFilmBuild] = useState<Build | null>(null);
  const palette = useMemo(() => Promise.resolve(PALETTE), []);
  const scene = useRef<BlockScene | null>(null);
  const last = (build?.steps.length ?? 0) - 1;

  const latest = useRef(0);
  const refreshBuilds = useCallback(() => {
    const request = ++latest.current;
    return library().then(
      ({ builds: next, failed }) => {
        if (request !== latest.current) return;
        const kept = (shelf: Shelf, previous: BuildSummary[] | null) =>
          failed.includes(shelf) ? (previous ?? []).filter((b) => (b.source === "session") === (shelf === "mine")) : [];
        setBuilds((previous) => [...kept("mine", previous), ...next, ...kept("public", previous)]);
        setBuildsFailed(failed);
      },
      (e) => {
        if (request !== latest.current) return;
        console.error(e);
        setBuildsFailed(["mine", "public"]);
      },
    );
  }, []);

  useEffect(() => void refreshBuilds(), [refreshBuilds, account.user.id, libraryOpen]);
  /** The user's sessions building now, which need this tab open. */
  const running = [
    ...new Set([
      ...(builds ?? [])
        .filter(
          (b) => b.source === "session" && b.status === "building" && (b.id !== live?.id || live.status === "building"),
        )
        .map((b) => b.id),
      ...(live?.status === "building" ? [live.id] : []),
    ]),
  ];
  useKeeper(running, refreshBuilds);

  const summary = builds?.find((b) => b.id === buildId && b.source === ref?.source);
  const name = build?.name ?? summary?.name;
  const listed = builds?.find((b) => b.id === buildId && b.source === "public");
  /** The build as anyone opens it: a showcase, or in the public library. */
  const shared: BuildRef | null =
    ref?.source === "session" ? (listed ? { id: ref.id, source: "public" } : null) : summary?.private ? null : ref;

  useEffect(() => {
    if (build && builds && summary?.status !== build.status) refreshBuilds();
  }, [build?.id, build?.status, summary?.status]);

  useEffect(() => {
    document.title = buildId && name ? `${name} · ${TITLE}` : TITLE;
  }, [buildId, name]);

  useEffect(() => {
    if (mode === "edit" && !edits.editable) setMode("view");
  }, [mode, edits.editable]);

  useEffect(() => {
    if (mode !== "edit") return;
    setPlaying(false);
    setFollowing(true);
  }, [mode, edits.edits]);

  const show = useCallback((next: BuildRef | null) => {
    setRef(next);
    setCenter("model");
    setMode("view");
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
  }, []);

  /** Show this build, with the library over it or not, and put both in the URL. */
  const navigate = useCallback(
    (next: BuildRef | null, library: boolean) => {
      if (!same(next, opened.current)) show(next);
      setLibraryOpen(library);
      const url = new URL(window.location.href);
      for (const param of [...Object.values(PARAMS), LIBRARY]) url.searchParams.delete(param);
      if (next) url.searchParams.set(PARAMS[next.source], next.id);
      if (library) url.search += `${url.search ? "&" : "?"}${LIBRARY}`;
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
    },
    [show],
  );
  const open = (next: BuildRef | null) => navigate(next, false);

  useEffect(() => {
    const sync = () => {
      const next = urlBuild();
      if (!same(next, opened.current)) show(next);
      setLibraryOpen(urlLibrary());
    };
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

  /** Start a build and open it: a new one, or a remix of `from`. */
  const start = async (prompt: string, images: string[], from?: Build) => {
    const id = await (from ? remix(from, prompt, images) : create(prompt, images));
    const title = from ? `${from.name} remix` : prompt || "Untitled build";
    remember(id, { name: title.slice(0, 60), prompt });
    open({ id, source: "session" });
    refreshBuilds();
  };

  const saveThumbnail = async (png: Blob) => {
    if (ref?.source !== "session") return;
    remember(ref.id, { thumbnail: await thumbnail(png) });
    refreshBuilds();
  };

  const onCounts = useCallback((c: Map<string, number> | null) => {
    setCounts(c);
    let n = 0;
    if (c) for (const k of c.values()) n += k;
    setBlockCount(n);
  }, []);

  /** The signed-in user's build, from their session or as they published it. */
  const owned = ref?.source === "session" || (ref?.source === "public" && summary?.owner === account.user.id);
  /** An imported build of theirs: it lives only in the library, with no session to fall back to. */
  const imported = owned && ref?.source === "public" && ref.id.startsWith("import-");

  const publishBuild = async () => {
    if (!build) return;
    const png = await scene.current?.thumbnail();
    const edited = live && edits.edits.length ? { revision: live.revision, edits: edits.edits } : null;
    await publish(build.id, png ? await thumbnail(png) : null, edited);
    await refreshBuilds();
  };

  const unpublishBuild = async () => {
    if (!build) return;
    // Unpublishing would delete an imported build; making it private keeps it under Mine.
    if (imported) await setPrivate(build.id, true);
    else {
      await unpublish(build.id);
      if (ref?.source === "public") open({ id: build.id, source: "session" });
    }
    await refreshBuilds();
  };

  const republish = async () => {
    if (!build) return;
    await setPrivate(build.id, false);
    await refreshBuilds();
  };

  const deleteBuild = async () => {
    if (!build) return;
    await unpublish(build.id);
    navigate(null, true);
    await refreshBuilds();
  };

  const closed =
    ref?.source === "showcase" ? (
      "A showcase from the gallery: remix it to make your own."
    ) : ref?.source === "public" ? (
      `Shared by ${summary?.author ?? "an H builder"}: remix it to make your own.`
    ) : live && !live.open && live.status !== "building" ? (
      <RecoveryPanel
        key={live.id}
        build={live}
        edited={edits.edits.length > 0}
        onOpen={(id) => {
          if (opened.current?.source === "session" && opened.current.id === live.id) open({ id, source: "session" });
          refreshBuilds();
        }}
      />
    ) : null;
  const recoveredFrom = ref?.source === "session" ? card(ref.id)?.recoveredFrom : undefined;
  const visibleStep = following ? last : Math.min(step, last);
  const hasBlocks = !!build?.boxes.length;
  const opening = `Opening ${name ?? "the build"}`;
  const libraryShown = libraryOpen || !ref;

  const downloadImage = async () => {
    const png = await scene.current?.image();
    if (png && build) save(png, `${build.name}.png`);
  };

  const downloadSchem = async () => {
    if (build) save(await schematic(build), `${build.name}.schem`);
  };

  return (
    <div className={running.length ? "app has-running" : "app"}>
      <header>
        <button className="brand" onClick={() => open(null)}>
          <img className="brand-logo" src="/logo.png" alt="" />
          Blockyard
        </button>
        <button
          className={libraryShown ? "library-toggle active" : "library-toggle"}
          aria-pressed={libraryShown}
          onClick={() => navigate(ref, !libraryOpen)}
        >
          <SquaresFourIcon size={16} /> <span>Library</span>
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
            {ref?.source === "public" && summary?.author && <span className="chip">by {summary.author}</span>}
            {syncError && (
              <span className="chip warn" role="status" title={syncError}>
                Reconnecting…
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        {build && owned && (
          <PublishButton
            published={imported ? !summary?.private : ref?.source === "public" || !!listed}
            imported={imported}
            blocked={
              build.status === "building" ? "Publish once Holo answers" : !hasBlocks ? "Nothing is built yet" : null
            }
            author={account.user.name}
            onPublish={imported ? republish : publishBuild}
            onUnpublish={unpublishBuild}
          />
        )}
        {build && shared && <CopyLink url={linkTo(shared)} />}
        {build && imported && <DeleteButton name={build.name} onDelete={deleteBuild} />}
        <ThemeToggle />
        {build && !error && hasBlocks && <DownloadMenu onSchem={downloadSchem} onImage={downloadImage} />}
        <AccountMenu account={account} building={running.length > 0} />
      </header>
      {running.length > 0 && (
        <div className="build-notice" role="note" aria-label="Keep Blockyard open">
          <strong>Keep this tab open while Holo builds.</strong> Your browser renders the model for Holo. You can browse
          within Blockyard; closing this tab, leaving the site or sleeping your device can interrupt the build.
        </div>
      )}
      <aside>
        <div className="aside-head">
          <span className="aside-title">Chat</span>
          {buildId && (
            <button className="new-build" onClick={() => open(null)}>
              <PlusIcon size={14} weight="bold" />
              New build
            </button>
          )}
        </div>
        {recoveredFrom && (
          <p className="recovery-origin">
            Recovery attempt ·{" "}
            <a
              href={linkTo({ id: recoveredFrom, source: "session" })}
              onClick={(event) => {
                event.preventDefault();
                open({ id: recoveredFrom, source: "session" });
              }}
            >
              Open original build
            </a>
          </p>
        )}
        <ChatPanel
          key={ref ? `${ref.source}:${ref.id}` : "new"}
          buildId={buildId}
          build={live}
          loadFailed={!!error}
          activity={activity}
          closed={closed}
          onCreate={(prompt, images) => start(prompt, images)}
          onSay={(text, images) => say(buildId!, text, images)}
          onStop={async () => void (await stop(buildId!))}
          onRemix={async (text, images) => {
            if (build) await start(text, images, build);
          }}
        />
      </aside>
      <main>
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
                  onClick={() => {
                    setCenter(t.id);
                    if (t.id !== "model") setMode("view");
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {center === "model" && !error && (
              <ViewControls
                framing={framing}
                spin={spin}
                mode={mode}
                canEdit={edits.editable && hasBlocks}
                canWalk={hasBlocks}
                onFrame={(next) => {
                  if (mode === "walk") setMode("view");
                  setFraming(next);
                }}
                onSpin={setSpin}
                onMode={setMode}
              />
            )}
          </div>
          <div className="stage">
            <div className={center === "model" ? "pane" : "pane hidden"}>
              <Viewer
                build={build}
                step={visibleStep}
                framing={framing}
                spin={spin}
                onThumbnail={saveThumbnail}
                palette={palette}
                onCounts={onCounts}
                scene={scene}
                loading={buildId && !counts && !error ? opening : null}
                failed={renderFailed}
                onFailed={setRenderFailed}
                mode={mode}
                edits={edits}
                onMode={setMode}
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
                <button onClick={() => navigate(null, true)}>Back to the library</button>
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
              onShare={() => setFilmBuild(build)}
              spaceKey={mode !== "walk"}
            />
          )}
        </div>
        {libraryShown && (
          <LibraryPage
            builds={builds}
            failed={buildsFailed}
            active={ref}
            onRetry={refreshBuilds}
            onClose={ref ? () => navigate(ref, false) : null}
            onOpen={(b) => {
              const mine = b.source === "public" && builds?.some((s) => s.source === "session" && s.id === b.id);
              open({ id: b.id, source: mine ? "session" : b.source });
            }}
            me={account.user.id}
            mineActions={
              <ImportBuild
                onImported={(id) => {
                  refreshBuilds();
                  open({ id, source: "public" });
                }}
              />
            }
          />
        )}
      </main>
      {filmBuild && <FilmExport build={filmBuild} onClose={() => setFilmBuild(null)} />}
    </div>
  );
}
