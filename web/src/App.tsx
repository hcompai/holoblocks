import { replayDelay } from "./buildTiming";
import { CaretLeftIcon, PlusIcon } from "@phosphor-icons/react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Account } from "./account";
import { AccountMenu } from "./AccountMenu";
import { PHASES } from "./activity";
import { cancel, create, remix, say, stop } from "./agent";
import { BlockLoader } from "./BlockLoader";
import { BlocksPanel } from "./BlocksPanel";
import { ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { useEdits } from "./edits";
import { FilmExport } from "./FilmExport";
import { HomeShelves } from "./HomeShelves";
import { ImportBuild } from "./ImportBuild";
import { card, library, publish, remember, remove, setPrivate, type Shelf, thumbnail, unpublish } from "./library";
import { type Build, type BuildSummary, EMPTY_MODEL, PALETTE, type Source } from "./model";
import { RecoveryPanel } from "./RecoveryPanel";
import type { BlockScene } from "./scene";
import { ShareMenu } from "./ShareMenu";
import { label } from "./suggestions";
import { ThemeToggle } from "./ThemeToggle";
import { Timeline } from "./Timeline";
import { type BuildRef, useBuild } from "./useBuild";
import { useKeeper } from "./useSession";
import { useSheet } from "./useSheet";
import { usePhone } from "./usePhone";
import { type Framing, type Mode, RenderFailed, ViewControls, Viewer } from "./Viewer";

const TITLE = document.title;
const NEW_BUILD = "New build";
const CENTER_TABS = [
  { id: "model", label: "Model" },
  { id: "code", label: "Code" },
  { id: "blocks", label: "Blocks" },
] as const;
/** The URL parameter naming the open build, by where it is read from. */
const PARAMS: Record<Source, string> = { session: "build", public: "public", showcase: "showcase" };

function urlBuild(): BuildRef | null {
  const params = new URLSearchParams(window.location.search);
  for (const [source, param] of Object.entries(PARAMS) as [Source, string][]) {
    const id = params.get(param);
    if (id) return { id, source };
  }
  return null;
}

const linkTo = (ref: BuildRef) => `${window.location.origin}/?${new URLSearchParams({ [PARAMS[ref.source]]: ref.id })}`;

const same = (a: BuildRef | null, b: BuildRef | null) => a?.id === b?.id && a?.source === b?.source;

export default function App({ account }: { account: Account }) {
  const [ref, setRef] = useState<BuildRef | null>(urlBuild);
  const opened = useRef(ref);
  opened.current = ref;
  const buildId = ref?.id ?? null;
  const read = useBuild(ref);
  /** What the user just asked for, shown as a starting build where they asked it, until its session answers. */
  const [draft, setDraft] = useState<{ at: BuildRef | null; build: Build; since: number } | null>(null);
  const drafted = draft && same(draft.at, ref) && read.build?.id !== draft.build.id ? draft.build : null;
  const live = drafted ?? read.build;
  const activity = drafted ? { label: PHASES.idea, since: draft!.since, work: null } : read.activity;
  const { error, syncError } = read;
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
  const [placing, setPlacing] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [blockCount, setBlockCount] = useState(0);
  const [renderFailed, setRenderFailed] = useState(false);
  const [framing, setFraming] = useState<Framing>({ view: "iso" });
  const [spin, setSpin] = useState(false);
  const [followCamera, setFollowCamera] = useState(true);
  const [filmBuild, setFilmBuild] = useState<Build | null>(null);
  const phone = usePhone();
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const sheet = useSheet(dock);
  const palette = useMemo(() => Promise.resolve(PALETTE), []);
  const scene = useRef<BlockScene | null>(null);
  const last = (build?.steps.length ?? 0) - 1;
  const built = !!build?.boxes.length;

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

  const home = !ref && !drafted;
  useEffect(() => void refreshBuilds(), [refreshBuilds, account.user.id, home]);
  /** The user's sessions building now, which need this tab open. */
  const running = [
    ...new Set([
      ...(builds ?? [])
        .filter(
          (b) =>
            b.source === "session" &&
            b.status === "building" &&
            (b.id !== read.build?.id || read.build.status === "building"),
        )
        .map((b) => b.id),
      ...(read.build?.status === "building" && ref?.source === "session" ? [read.build.id] : []),
    ]),
  ];
  useKeeper(running, refreshBuilds);

  const summary = builds?.find((b) => b.id === buildId && b.source === ref?.source);
  const heading = build ?? summary;
  const listed = builds?.find((b) => b.id === buildId && b.source === "public");
  /** The build as anyone opens it: a showcase, or in the public library. */
  const shared: BuildRef | null =
    ref?.source === "session" ? (listed ? { id: ref.id, source: "public" } : null) : summary?.private ? null : ref;

  useEffect(() => {
    if (build && builds && summary?.status !== build.status) refreshBuilds();
  }, [build?.id, build?.status, summary?.status]);

  useEffect(() => {
    document.title = heading ? `${heading.name} · ${TITLE}` : TITLE;
  }, [heading?.name]);

  useEffect(() => {
    if ((mode === "edit" && !edits.editable) || (mode !== "view" && !built)) setMode("view");
    if (mode !== "view") setFollowCamera(false);
  }, [mode, edits.editable, built]);

  useEffect(() => {
    if (mode !== "edit") return;
    setPlaying(false);
    setFollowing(true);
  }, [mode, edits.edits]);

  const show = useCallback((next: BuildRef | null) => {
    setRef(next);
    setDraft(null);
    setCenter("model");
    setMode("view");
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
    setFollowCamera(true);
    setSpin(false);
  }, []);

  /** Show this build, or home for none, and put it in the URL. */
  const open = (next: BuildRef | null) => {
    if (!same(next, opened.current)) show(next);
    const url = new URL(window.location.href);
    for (const param of Object.values(PARAMS)) url.searchParams.delete(param);
    if (next) url.searchParams.set(PARAMS[next.source], next.id);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  };

  useEffect(() => {
    const sync = () => {
      const next = urlBuild();
      if (!same(next, opened.current)) show(next);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [show]);

  useEffect(() => {
    if (following) setStep(last);
  }, [following, last]);

  useEffect(() => {
    if (!playing || placing) return;
    if (step >= last) {
      setPlaying(false);
      setFollowing(true);
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), replayDelay(step, speed));
    return () => clearTimeout(timer);
  }, [playing, placing, speed, step, last]);

  const scrub = (s: number) => {
    setPlaying(false);
    setStep(s);
    setFollowing(s >= last);
  };

  /** Start a build and show it at once: a new one, or a copy of `from` that Holo changes as asked, under the same name if it is the user's. */
  const start = async (prompt: string, images: string[], from?: Build) => {
    const name = from ? (owned ? from.name : `${from.name} remix`) : (label(prompt) ?? NEW_BUILD);
    const at = opened.current;
    const since = Date.now();
    const build: Build = {
      ...EMPTY_MODEL,
      boxes: [],
      id: "",
      name,
      status: "building",
      open: false,
      messages: [{ role: "user", text: prompt, images }],
    };
    setDraft({ at, build, since });
    try {
      const id = await (from ? remix(from, prompt, images) : create(prompt, images));
      remember(id, { name: name.slice(0, 60), prompt });
      refreshBuilds();
      if (!same(opened.current, at)) return;
      const next: BuildRef = { id, source: "session" };
      open(next);
      setDraft({ at: next, build: { ...build, id }, since });
    } catch (e) {
      setDraft((current) => (current?.build === build ? null : current));
      throw e;
    }
  };

  /** Open a listed build: the user's public builds as their session, when they have one. */
  const openListed = (b: BuildSummary) => {
    const session = b.source === "public" && builds?.some((s) => s.source === "session" && s.id === b.id);
    open({ id: b.id, source: session ? "session" : b.source });
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
  /** Theirs in the library, or one of the sessions the platform lists as theirs. */
  const deletable =
    owned && (ref?.source === "public" || !!builds?.some((b) => b.source === "session" && b.id === ref?.id));

  const publishBuild = async () => {
    if (!build) return;
    const png = await scene.current?.thumbnail();
    const edited = live && edits.edits.length ? { revision: live.revision, edits: edits.edits } : null;
    await publish(build.id, png ? await thumbnail(png) : null, edited);
    await refreshBuilds();
  };

  const unpublishBuild = async () => {
    if (!build) return;
    // Unpublishing would delete an imported build; making it private keeps it under the user's builds.
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
    if (build.status === "building") await cancel(build.id).catch(console.error);
    await remove(build.id);
    open(null);
    await refreshBuilds();
  };

  const closed =
    ref?.source === "showcase" ? (
      "A showcase from the gallery: remix it to make your own."
    ) : ref?.source === "public" ? (
      `Shared by ${summary?.author ?? "an H builder"}: remix it to make your own.`
    ) : live && !drafted && live.status === "error" ? (
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
  const opening = `Opening ${heading?.name ?? "the build"}`;
  /** The open build, once it is more than a request on its way. */
  const actionable = drafted ? null : build;
  const loading = error ? null : !build ? buildId && opening : !built ? null : counts ? null : opening;
  /** On a phone, the chat is a bottom sheet over the model, and holds the code and blocks too. */
  const sheeted = phone && !home;
  const pick = (id: (typeof CENTER_TABS)[number]["id"]) => {
    setCenter(id);
    if (id !== "model") setMode("view");
    if (sheeted && id !== "model" && sheet.detent === "peek") sheet.setDetent("half");
  };
  const panel =
    center === "code" && build ? (
      <CodePanel build={build} step={visibleStep} onStep={scrub} />
    ) : center === "blocks" && counts ? (
      <BlocksPanel counts={counts} palette={palette} />
    ) : center === "blocks" && renderFailed ? (
      <RenderFailed />
    ) : (
      !error && <BlockLoader label={opening} />
    );

  return (
    <div
      className={home ? "app home" : "app"}
      style={sheeted ? ({ "--peek": `${sheet.peek}px` } as CSSProperties) : undefined}
    >
      <header>
        {sheeted ? (
          <button className="back" aria-label="All builds" title="All builds" onClick={() => open(null)}>
            <CaretLeftIcon size={20} weight="bold" />
          </button>
        ) : (
          <button className="brand" onClick={() => open(null)}>
            <img className="brand-logo" src="/logo.png" alt="" />
            HoloBlocks
          </button>
        )}
        {sheeted && heading && (
          <span className="title" title={heading.name}>
            {heading.name}
          </span>
        )}
        {syncError && (
          <span className="chip warn" role="status" title={syncError}>
            Reconnecting…
          </span>
        )}
        <span className="spacer" />
        {actionable && !error && (
          <ShareMenu
            build={actionable}
            link={shared && linkTo(shared)}
            publishing={
              owned
                ? {
                    published: imported ? !summary?.private : ref?.source === "public" || !!listed,
                    imported,
                    blocked:
                      actionable.status === "building"
                        ? "Publish once Holo answers"
                        : !built
                          ? "Nothing is built yet"
                          : null,
                    author: account.user.name,
                    onPublish: imported ? republish : publishBuild,
                    onUnpublish: unpublishBuild,
                  }
                : null
            }
            onDelete={deletable ? deleteBuild : null}
            image={() => scene.current?.image() ?? Promise.resolve(null)}
            onGif={() => setFilmBuild(actionable)}
          />
        )}
        {!sheeted && <ThemeToggle />}
        {!sheeted && <AccountMenu account={account} building={running.length > 0} />}
      </header>
      <aside
        className={sheeted ? `sheet${center !== "model" ? " panel" : ""}` : undefined}
        data-detent={sheeted ? sheet.detent : undefined}
        style={sheeted ? sheet.style : undefined}
        onFocus={(e) => {
          if (sheeted && e.target instanceof HTMLTextAreaElement && sheet.detent === "peek") sheet.setDetent("half");
        }}
      >
        {sheeted && (
          <div className="sheet-handle" {...sheet.handle}>
            <span />
          </div>
        )}
        {sheeted ? (
          <div className="aside-head" {...sheet.handle}>
            <div className="tabs" role="tablist">
              {CENTER_TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={center === t.id}
                  className={center === t.id ? "active" : ""}
                  disabled={t.id !== "model" && !actionable}
                  onClick={() => pick(t.id)}
                >
                  {t.id === "model" ? "Chat" : t.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="aside-head">
            <span className="aside-title" title={heading?.name}>
              {heading?.name || "Chat"}
            </span>
            {ref && (
              <button className="quiet" onClick={() => open(null)}>
                <PlusIcon size={14} weight="bold" />
                New build
              </button>
            )}
          </div>
        )}
        <div className="aside-body">
          {sheeted && center !== "model" && <div className="sheet-panel">{panel}</div>}
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
            onSay={async (text, images) => {
              if (live?.id) await say(live.id, text, images);
            }}
            onStop={async () => {
              if (live?.id) await stop(live.id);
            }}
            onRemix={async (text, images) => {
              if (build) await start(text, images, build);
            }}
            dockRef={setDock}
          />
          {home && (
            <HomeShelves
              builds={builds}
              failed={buildsFailed}
              me={account.user.id}
              onRetry={refreshBuilds}
              onOpen={openListed}
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
        </div>
      </aside>
      <main>
        <div className={home ? "workspace hidden" : "workspace"}>
          <div className="stage-head">
            <div className="tabs" role="tablist">
              {CENTER_TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={center === t.id}
                  className={center === t.id ? "active" : ""}
                  disabled={t.id !== "model" && !actionable}
                  onClick={() => pick(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {(center === "model" || sheeted) && !error && (
              <ViewControls
                framing={framing}
                spin={spin}
                followCamera={followCamera && mode === "view"}
                onFollowCamera={(follow) => {
                  setFollowCamera(follow);
                  if (follow) setSpin(false);
                }}
                mode={mode}
                canEdit={edits.editable && built}
                built={built}
                onFrame={(next) => {
                  if (mode === "walk") setMode("view");
                  setFollowCamera(false);
                  setFraming(next);
                }}
                onSpin={(next) => {
                  setFollowCamera(false);
                  setSpin(next);
                }}
                onMode={(next) => {
                  if (next !== "view") setFollowCamera(false);
                  setMode(next);
                }}
              />
            )}
          </div>
          <div className="stage">
            <div className={center === "model" || sheeted ? "pane" : "pane hidden"}>
              <Viewer
                build={build}
                step={visibleStep}
                framing={framing}
                spin={spin}
                followCamera={followCamera}
                onFollowCamera={setFollowCamera}
                onThumbnail={saveThumbnail}
                palette={palette}
                onCounts={onCounts}
                scene={scene}
                loading={loading}
                thinking={!error && !built && build?.status === "building" ? activity : null}
                placementSpeed={speed}
                onPlacing={setPlacing}
                failed={renderFailed}
                onFailed={setRenderFailed}
                mode={mode}
                edits={edits}
                onMode={setMode}
              />
              {build && !built && build.status !== "building" && (
                <div className="notice">There's nothing here yet, so ask Holo in the chat to start building.</div>
              )}
            </div>
            {center !== "model" && !sheeted && <div className="pane">{panel}</div>}
            {error && (
              <div className="pane notice" role="alert">
                <b>{error}</b>
                <button onClick={() => open(null)}>Back to the start</button>
              </div>
            )}
          </div>
          {!error && (!build || built) && (
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
              blocks={counts ? blockCount : null}
              spaceKey={mode !== "walk"}
            />
          )}
        </div>
      </main>
      {filmBuild && <FilmExport build={filmBuild} onClose={() => setFilmBuild(null)} />}
    </div>
  );
}
