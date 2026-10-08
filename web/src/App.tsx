import { replayDelay } from "./buildTiming";
import {
  CaretLeftIcon,
  ClockCounterClockwiseIcon,
  FilmStripIcon,
  GitForkIcon,
  PlusIcon,
  SignInIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Account, signInError } from "./account";
import { AccountMenu } from "./AccountMenu";
import { PHASES } from "./activity";
import { cancel, create, say, stop } from "./agent";
import { BlockLoader } from "./BlockLoader";
import { BlocksPanel } from "./BlocksPanel";
import { type ChatHandle, ChatPanel } from "./ChatPanel";
import { CodePanel } from "./CodePanel";
import { useEdits } from "./edits";
import { FilmExport } from "./FilmExport";
import { forkOperation, startFork } from "./fork";
import { type ForkSeed, forkSeed } from "./forkModel";
import { HistoryPanel } from "./HistoryPanel";
import { design, useHistory, type Version } from "./history";
import { HomeShelves } from "./HomeShelves";
import { ImportBuild } from "./ImportBuild";
import { SiteFooter } from "./Legal";
import {
  card,
  library,
  LibraryError,
  markPublished,
  publish,
  publishedBefore,
  remember,
  remove,
  saveFork,
  setPrivate,
  type Shelf,
  thumbnail,
  unpublish,
} from "./library";
import { type Build, type BuildSummary, EMPTY_MODEL, pack, PALETTE, type Source, stepCount, unpack } from "./model";
import type { ProjectActions } from "./ProjectMenu";
import { ProjectTitle } from "./ProjectTitle";
import { FinishedCard } from "./FinishedCard";
import { RecoveryPanel } from "./RecoveryPanel";
import type { BlockScene } from "./scene";
import { selectedArea } from "./selectedArea";
import { SESSION_DELETE_NOTE, ShareMenu, type Publishing } from "./ShareMenu";
import { SignInDialog } from "./SignInDialog";
import { label } from "./suggestions";
import { ThemeToggle } from "./ThemeToggle";
import { VisibilityToggle } from "./VisibilityToggle";
import { Timeline } from "./Timeline";
import { type BuildRef, useBuild } from "./useBuild";
import { useProjectNames } from "./useProjectNames";
import { useKeeper } from "./useSession";
import { useSheet } from "./useSheet";
import { usePhone } from "./usePhone";
import { useViewport } from "./useViewport";
import { type Framing, type Mode, RenderFailed, ViewControls, Viewer } from "./Viewer";
import { extent } from "./voxels";

const TITLE = document.title;
const NEW_BUILD = "New build";
const CENTER_TABS = [
  { id: "model", label: "Model" },
  { id: "code", label: "Code" },
  { id: "blocks", label: "Blocks" },
] as const;
/** The URL parameter naming the open build, by where it is read from. */
const PARAMS: Record<Source, string> = { session: "build", public: "public", showcase: "showcase", fork: "fork" };
/** The URL parameter naming the previewed version of the open build. */
const VERSION = "version";

function urlBuild(): BuildRef | null {
  const params = new URLSearchParams(window.location.search);
  for (const [source, param] of Object.entries(PARAMS) as [Source, string][]) {
    const id = params.get(param);
    if (id) return { id, source };
  }
  return null;
}

function urlVersion(): number | null {
  const n = Number(new URLSearchParams(window.location.search).get(VERSION));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const linkTo = (ref: BuildRef, version: number | null = null) =>
  `${window.location.origin}/?${new URLSearchParams({
    [PARAMS[ref.source]]: ref.id,
    ...(version !== null && { [VERSION]: String(version) }),
  })}`;

const same = (a: BuildRef | null, b: BuildRef | null) => a?.id === b?.id && a?.source === b?.source;

/** A build of a session, rather than a fork or an import: the platform keeps every session, so deleting one hides it. */
const isSession = (id: string) => !id.startsWith("fork-") && !id.startsWith("import-");

export default function App({ account }: { account: Account | null }) {
  const [ref, setRef] = useState<BuildRef | null>(urlBuild);
  const opened = useRef(ref);
  opened.current = ref;
  const buildId = ref?.id ?? null;
  /** A session or a fork, signed out: opening it needs the user's Agents API key. */
  const locked = !account && (ref?.source === "session" || ref?.source === "fork");
  const read = useBuild(locked ? null : ref);
  const { names, rename } = useProjectNames(account?.user.id ?? null);
  const [signingIn, setSigningIn] = useState(() => !account && signInError !== null);
  const askSignIn = () => setSigningIn(true);
  /** What the user just asked for, shown as a starting build where they asked it, until its session answers. */
  const [draft, setDraft] = useState<{ at: BuildRef | null; build: Build; since: number } | null>(null);
  const drafted = draft && same(draft.at, ref) && read.build?.id !== draft.build.id ? draft.build : null;
  const unnamed = useMemo(() => {
    if (drafted) return drafted;
    if (draft && same(draft.at, ref) && read.build && !read.build.messages.some((m) => m.role === "user"))
      return { ...read.build, messages: [...draft.build.messages, ...read.build.messages] };
    return read.build;
  }, [drafted, draft, ref, read.build]);
  const named = ref && names[ref.id];
  const live = useMemo(() => (unnamed && named ? { ...unnamed, name: named.name } : unnamed), [unnamed, named]);
  const observed = drafted ? { label: PHASES.idea, since: draft!.since, work: null } : read.activity;
  const activity =
    observed && !live?.boxes.length && (observed.label === PHASES.blocks || observed.label === PHASES.checking)
      ? { ...observed, label: PHASES.draft }
      : observed;
  const { syncError, models, seed, runId, attachSession } = read;
  const error = locked ? "Sign in to open this build." : read.error;
  const edits = useEdits(live);
  const [historyOpen, setHistoryOpen] = useState(() => urlVersion() !== null);
  /** The version the URL asks for, until the history has loaded it. */
  const [wantedVersion, setWantedVersion] = useState<number | null>(urlVersion);
  const [selected, setSelected] = useState<Version | null>(null);
  const history = useHistory(
    ref?.source === "session" || ref?.source === "fork" ? ref.id : null,
    models,
    seed?.model ?? null,
    historyOpen || wantedVersion !== null,
  );
  /** An earlier version is shown, read only: the builder, the chat and the hand edits stay on the latest. */
  const previewing = selected !== null || wantedVersion !== null;
  const previewed = useMemo(() => selected && unpack(selected.model), [selected]);
  /** The build as shown: a previewed version, or the latest with this browser's hand edits. */
  const build =
    wantedVersion !== null
      ? null
      : previewed && live
        ? { ...live, ...previewed, name: live.name, open: false }
        : edits.build;
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState("");
  /** The fork being saved for this design: a retry after a lost response saves the same fork. */
  const forkAttempt = useRef<{ key: string; id: string; seed: ForkSeed } | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [loadedBuilds, setBuilds] = useState<BuildSummary[] | null>(null);
  const builds = useMemo(
    () => loadedBuilds?.map((b) => (names[b.id] ? { ...b, name: names[b.id].name } : b)) ?? null,
    [loadedBuilds, names],
  );
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
  const viewport = useViewport(phone);
  const sheet = useSheet(dock, viewport?.height);
  const palette = useMemo(() => Promise.resolve(PALETTE), []);
  const scene = useRef<BlockScene | null>(null);
  const chat = useRef<ChatHandle>(null);
  const last = (build?.steps.length ?? 0) - 1;
  const built = !!build?.boxes.length;
  const size = useMemo(
    () => (build?.boxes.length ? extent(build, PALETTE) : null),
    [build?.boxes, build?.width, build?.height, build?.depth],
  );

  const latest = useRef(0);
  const refreshBuilds = useCallback(() => {
    const request = ++latest.current;
    return library().then(
      ({ builds: next, failed }) => {
        if (request !== latest.current) return;
        const yours = (b: BuildSummary) => b.source === "session" || b.source === "fork";
        const kept = (shelf: Shelf, previous: BuildSummary[] | null) =>
          failed.includes(shelf) ? (previous ?? []).filter((b) => yours(b) === (shelf === "mine")) : [];
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
  useEffect(() => void refreshBuilds(), [refreshBuilds, home]);
  const hasPublic = !!builds?.some((b) => b.source === "public" && b.owner === account?.user.id && !b.private);
  useEffect(() => {
    if (hasPublic) markPublished();
  }, [hasPublic]);
  /** The build this tab watched Holo finish, celebrated over the model until dismissed. */
  const [finished, setFinished] = useState<string | null>(null);
  const watched = useRef<{ id: string; building: boolean } | null>(null);
  useEffect(() => {
    const previous = watched.current;
    watched.current = live ? { id: live.id, building: live.status === "building" } : null;
    if (previous?.building && live?.id === previous.id && live.status === "done" && live.boxes.length)
      setFinished(live.id);
  }, [live?.id, live?.status]);
  useLayoutEffect(() => {
    const field = document.activeElement;
    if (home && viewport && field instanceof HTMLTextAreaElement) field.scrollIntoView({ block: "nearest" });
  }, [home, viewport]);
  /** Sessions this tab started, before the library lists them. */
  const started = useRef(new Set<string>());
  /** One of the user's sessions: started here, or listed as theirs, alone or behind a fork. */
  const mine = (id: string) =>
    started.current.has(id) ||
    !!builds?.some((b) => (b.source === "session" || b.source === "fork") && (b.sessionId ?? b.id) === id);
  /** The user's sessions building now, which need this tab open. */
  const running = [
    ...new Set([
      ...(builds ?? [])
        .filter(
          (b) =>
            (b.source === "session" || b.source === "fork") &&
            b.status === "building" &&
            ((b.sessionId ?? b.id) !== runId || read.build?.status === "building"),
        )
        .map((b) => b.sessionId ?? b.id),
      ...(read.build?.status === "building" && runId && mine(runId) ? [runId] : []),
    ]),
  ];
  useKeeper(running, refreshBuilds);

  const summary = builds?.find((b) => b.id === buildId && b.source === ref?.source);
  const heading = build ?? summary;
  const listed = builds?.find((b) => b.id === buildId && b.source === "public");
  /** The build as anyone opens it: a showcase, or in the public library. */
  const shared: BuildRef | null =
    ref?.source === "session" || ref?.source === "fork"
      ? listed
        ? { id: ref.id, source: "public" }
        : null
      : summary?.private
        ? null
        : ref;

  useEffect(() => {
    if (live && builds && summary?.status !== live.status) refreshBuilds();
  }, [live?.id, live?.status, summary?.status]);

  useEffect(() => {
    document.title = heading ? `${heading.name} · ${TITLE}` : TITLE;
  }, [heading?.name]);

  useEffect(() => {
    if ((mode === "edit" && (!edits.editable || previewing)) || (mode !== "view" && !built)) setMode("view");
    if (mode !== "view") setFollowCamera(false);
  }, [mode, edits.editable, built, previewing]);

  useEffect(() => {
    if (wantedVersion === null || history.loading || history.error || read.loading) return;
    const version = history.versions.find((v) => v.number === wantedVersion);
    if (!version) return;
    setSelected(version);
    setWantedVersion(null);
  }, [wantedVersion, history.versions, history.loading, history.error, read.loading]);

  useEffect(() => {
    if (mode !== "edit") return;
    setPlaying(false);
    setFollowing(true);
  }, [mode, edits.edits]);

  const show = useCallback((next: BuildRef | null, version: number | null = null) => {
    setRef(next);
    setDraft(null);
    setCenter("model");
    setMode("view");
    setStep(Infinity);
    setFollowing(true);
    setPlaying(false);
    setFollowCamera(true);
    setSpin(false);
    setHistoryOpen(version !== null);
    setWantedVersion(version);
    setSelected(null);
    setForkError("");
    forkAttempt.current = null;
  }, []);

  /** Show this build at its latest or at `version`, or home for none, and put it in the URL. */
  const open = (next: BuildRef | null, version: number | null = null) => {
    show(next, version);
    const url = new URL(window.location.href);
    for (const param of [...Object.values(PARAMS), VERSION]) url.searchParams.delete(param);
    if (next) url.searchParams.set(PARAMS[next.source], next.id);
    if (next && version !== null) url.searchParams.set(VERSION, String(version));
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  };

  useEffect(() => {
    const sync = () => show(urlBuild(), urlVersion());
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
  const start = async (prompt: string, images: string[], from?: Build, attached: Record<string, Blob> = {}) => {
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
      const id = await (from && at
        ? forkOperation()(
            forkSeed(
              { ...from, ...pack(from.boxes) },
              { ...at, name: from.name, version: selected?.number ?? null, revision: from.revision },
              name,
            ),
            prompt,
            images,
            attached,
          )
        : create(prompt, images));
      started.current.add(id);
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
    const own =
      b.source === "public" && builds?.find((s) => (s.source === "session" || s.source === "fork") && s.id === b.id);
    open({ id: b.id, source: own ? own.source : b.source });
  };

  const saveThumbnail = async (png: Blob) => {
    if (previewing || !owned || (ref?.source !== "session" && ref?.source !== "fork")) return;
    remember(ref.id, { thumbnail: await thumbnail(png) });
    refreshBuilds();
  };

  const onCounts = useCallback((c: Map<string, number> | null) => {
    setCounts(c);
    let n = 0;
    if (c) for (const k of c.values()) n += k;
    setBlockCount(n);
  }, []);

  /** The signed-in user's build: one of their sessions or forks, or as they published it. */
  const owned =
    ref?.source === "fork"
      ? !!read.build
      : ref?.source === "session"
        ? mine(ref.id)
        : ref?.source === "public" && !!account && summary?.owner === account.user.id;
  /** An imported build of theirs: it lives only in the library, with no session to fall back to. */
  const imported = owned && ref?.source === "public" && ref.id.startsWith("import-");
  const manageable = owned && !previewing;

  const publishBuild = async () => {
    if (!live || previewing) return;
    const png = await scene.current?.thumbnail();
    const hand = edits.edits.length ? { revision: live.revision, edits: edits.edits } : null;
    await publish(live.id, png ? await thumbnail(png) : null, hand);
    await refreshBuilds();
  };

  const unpublishBuild = async () => {
    if (!live) return;
    // Unpublishing would delete an imported build; making it private keeps it under the user's builds.
    if (imported) await setPrivate(live.id, true);
    else {
      await unpublish(live.id);
      if (ref?.source === "public") open({ id: live.id, source: live.id.startsWith("fork-") ? "fork" : "session" });
    }
    await refreshBuilds();
  };

  const republish = async () => {
    if (!live) return;
    await setPrivate(live.id, false);
    await refreshBuilds();
  };

  const deleteBuild = async () => {
    if (!live) return;
    if (live.status === "building" && runId) await cancel(runId).catch(console.error);
    await remove(live.id);
    open(null);
    await refreshBuilds();
  };

  /** A card's menu, for one of the user's own builds: a session, a fork or an imported build. */
  const manage = (b: BuildSummary, published: boolean): ProjectActions | null => {
    if (!account) return null;
    if (b.source !== "session" && b.source !== "fork" && !(b.source === "public" && b.owner === account.user.id))
      return null;
    const isImport = b.id.startsWith("import-");
    return {
      name: b.name,
      published,
      imported: isImport,
      onRename: (name) => rename(b.id, name),
      onVisibility: async (makePublic) => {
        if (isImport) await setPrivate(b.id, !makePublic);
        else if (makePublic) await publish(b.id, b.thumbnail?.startsWith("data:image/") ? b.thumbnail : null, null);
        else await unpublish(b.id);
        await refreshBuilds();
      },
      onDelete: async () => {
        if (b.status === "building") await cancel(b.sessionId ?? b.id).catch(console.error);
        await remove(b.id);
        if (opened.current?.id === b.id) open(null);
        await refreshBuilds();
      },
      deleteNote: isSession(b.id) ? SESSION_DELETE_NOTE : undefined,
    };
  };

  const selectVersion = (version: Version | null) => {
    setWantedVersion(null);
    const url = new URL(window.location.href);
    if (version) url.searchParams.set(VERSION, String(version.number));
    else url.searchParams.delete(VERSION);
    window.history.replaceState(null, "", url);
    setSelected(version);
    setMode("view");
    setCenter("model");
    setFollowing(true);
    setStep(Infinity);
    setPlaying(false);
  };

  /** Save a private copy of the shown model, and open it; Holo starts on its first message. */
  const beginFork = async () => {
    if (!account) return askSignIn();
    if (!build?.boxes.length || !ref || wantedVersion !== null || forking) return;
    const key = `${ref.source}:${ref.id}:${design(build)}`;
    if (forkAttempt.current?.key !== key) {
      const saved = [...history.versions].reverse().find((v) => design(v.model) === design(build));
      const origin = {
        ...ref,
        name: build.name,
        version: selected?.number ?? saved?.number ?? null,
        revision: build.revision,
      };
      const seed = forkSeed({ ...build, ...pack(build.boxes) }, origin, `${build.name.slice(0, 70)} · Fork`);
      forkAttempt.current = { key, id: `fork-${crypto.randomUUID()}`, seed };
    }
    const attempt = forkAttempt.current;
    setForking(true);
    setForkError("");
    try {
      await saveFork(attempt.id, attempt.seed);
      if (same(ref, opened.current)) open({ id: attempt.id, source: "fork" });
      refreshBuilds();
    } catch (e) {
      setForkError(e instanceof LibraryError ? e.message : "Couldn't fork it. Try again.");
    } finally {
      setForking(false);
    }
  };

  const forkHint = account ? "Fork to edit" : "Sign in to fork";
  const closed =
    ref?.source === "showcase" ? (
      `Showcase · ${forkHint}`
    ) : ref?.source === "public" ? (
      [summary?.author ? `By ${summary.author}` : "Public build", live && stepCount(live.steps.length), forkHint]
        .filter(Boolean)
        .join(" · ")
    ) : live && !drafted && live.status === "error" ? (
      <RecoveryPanel
        key={live.id}
        build={runId ? { ...live, id: runId } : live}
        edited={edits.edits.length > 0}
        onOpen={(id) => {
          started.current.add(id);
          if (same(ref, opened.current)) open({ id, source: "session" });
          refreshBuilds();
        }}
      />
    ) : null;
  const preview = previewing && (
    <>
      <p>
        {selected
          ? `Previewing V${selected.number}, read only`
          : history.loading || read.loading
            ? "Opening the version…"
            : "This version is unavailable."}
      </p>
      <button onClick={() => selectVersion(null)}>Latest</button>
      <button disabled={!selected || forking} onClick={beginFork}>
        <GitForkIcon size={14} weight="bold" /> Fork
      </button>
    </>
  );
  const renameTitle = ref && manageable ? (name: string) => rename(ref.id, name) : undefined;
  const recoveredFrom = ref?.source === "session" ? card(ref.id)?.recoveredFrom : undefined;
  const visibleStep = following ? last : Math.min(step, last);
  const opening = `Opening ${heading?.name ?? "the build"}`;
  /** The open build, once it is more than a request on its way. */
  const actionable = drafted ? null : build;
  const publishing: Publishing | null =
    actionable && manageable && account
      ? {
          published: imported ? !summary?.private : ref?.source === "public" || !!listed,
          imported,
          blocked:
            actionable.status === "building" ? "Publish once Holo answers" : !built ? "Nothing is built yet" : null,
          author: account.user.name,
          first: !hasPublic && !publishedBefore(),
          onPublish: imported ? republish : publishBuild,
          onUnpublish: unpublishBuild,
        }
      : null;
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
      style={
        {
          ...(sheeted && { "--peek": `${sheet.peek}px` }),
          ...(viewport && { "--phone-height": `${viewport.height}px`, "--phone-top": `${viewport.top}px` }),
        } as CSSProperties
      }
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
          <ProjectTitle
            key={`${ref?.source}:${ref?.id}`}
            className="title"
            name={heading.name}
            onRename={renameTitle}
          />
        )}
        {syncError && (
          <span className="chip warn" role="status" title={syncError}>
            Reconnecting…
          </span>
        )}
        <span className="spacer" />
        {actionable && !error && actionable.status === "done" && built && !loading && (
          <button className="primary" onClick={() => setFilmBuild(actionable)}>
            <FilmStripIcon size={16} />
            <span className="button-label">Share a GIF</span>
          </button>
        )}
        {publishing && !error && (
          <VisibilityToggle key={`${ref?.source}:${ref?.id}`} publishing={publishing} name={actionable!.name} />
        )}
        {actionable && !error && (
          <ShareMenu
            build={actionable}
            link={!previewing && shared ? linkTo(shared) : null}
            publishing={publishing}
            onDelete={manageable ? deleteBuild : null}
            deleteNote={ref && isSession(ref.id) ? SESSION_DELETE_NOTE : undefined}
            image={() => scene.current?.image() ?? Promise.resolve(null)}
            onGif={() => setFilmBuild(actionable)}
          />
        )}
        {!sheeted && <ThemeToggle />}
        {account ? (
          !sheeted && <AccountMenu account={account} building={running.length > 0} onRenamed={refreshBuilds} />
        ) : (
          <button className="sign-in-button" onClick={askSignIn}>
            <SignInIcon size={16} weight="bold" />
            <span className="button-label">Sign in</span>
          </button>
        )}
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
            <ProjectTitle
              key={`${ref?.source}:${ref?.id}`}
              className="aside-title"
              name={heading?.name || "Chat"}
              onRename={heading ? renameTitle : undefined}
            />
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
          {seed && (
            <p className="recovery-origin">
              Fork of{" "}
              <a
                href={linkTo(seed.origin, seed.origin.version)}
                onClick={(event) => {
                  event.preventDefault();
                  open({ id: seed.origin.id, source: seed.origin.source }, seed.origin.version);
                }}
              >
                {seed.origin.name}
                {seed.origin.version ? ` · V${seed.origin.version}` : ""}
              </a>
            </p>
          )}
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
            ref={chat}
            key={ref ? `${ref.source}:${ref.id}` : "new"}
            buildId={buildId}
            build={live}
            loadFailed={!!error}
            activity={activity}
            closed={closed}
            preview={preview}
            onCreate={(prompt, images) => start(prompt, images)}
            onSay={async (text, images, attached) => {
              if (!live?.id || previewing) return;
              if (runId) await say(runId, text, images, attached);
              else if (ref?.source === "fork" && seed) {
                const id = await startFork(ref.id, seed, text, images, attached);
                started.current.add(id);
                attachSession(id);
                refreshBuilds();
              }
            }}
            onStop={async () => {
              if (runId) await stop(runId);
            }}
            onRemix={async (text, images, attached) => {
              if (build && !previewing) await start(text, images, build, attached);
            }}
            onFork={beginFork}
            onSignIn={account ? undefined : askSignIn}
            dockRef={setDock}
          />
          {forkError && (
            <p className="chat-error" role="alert">
              {forkError}
            </p>
          )}
          {home && (
            <HomeShelves
              builds={builds}
              failed={buildsFailed}
              me={account?.user.id ?? null}
              onRetry={refreshBuilds}
              onOpen={openListed}
              manage={manage}
              mineActions={
                account && (
                  <ImportBuild
                    onImported={(id) => {
                      refreshBuilds();
                      open({ id, source: "public" });
                    }}
                  />
                )
              }
            />
          )}
        </div>
        {home && <SiteFooter />}
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
            {live && !drafted && !error && (
              <div className="tabs history-tools">
                {(ref?.source === "session" || ref?.source === "fork") && (
                  <button
                    className={historyOpen ? "active" : ""}
                    aria-pressed={historyOpen}
                    title="The models Holo shared"
                    onClick={() => setHistoryOpen(!historyOpen)}
                  >
                    <ClockCounterClockwiseIcon size={14} weight="bold" />
                    <span className="button-label">History</span>
                  </button>
                )}
                <button
                  disabled={forking || !build?.boxes.length}
                  title="Save a private copy of this model to change"
                  onClick={beginFork}
                >
                  <GitForkIcon size={14} weight="bold" />
                  <span className="button-label">{forking ? "Forking…" : "Fork"}</span>
                </button>
              </div>
            )}
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
                canEdit={!previewing && edits.editable && built}
                editHint={
                  previewing
                    ? "Go back to Latest, or fork this version, to edit it"
                    : live?.status === "building"
                      ? "Edit after Holo stops"
                      : edits.stale > 0
                        ? "Discard earlier edits to edit"
                        : undefined
                }
                built={built}
                size={size}
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
                  if (next === "edit" && previewing) return;
                  if (next !== "view") setFollowCamera(false);
                  setMode(next);
                }}
              />
            )}
          </div>
          {historyOpen && (
            <HistoryPanel
              {...history}
              selected={selected?.id ?? null}
              onRetry={history.retry}
              onSelect={selectVersion}
              onClose={() => setHistoryOpen(false)}
            />
          )}
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
                edits={previewing ? { ...edits, editable: false, stale: 0, hidden: 0 } : edits}
                onAsk={
                  !previewing && (ref?.source === "showcase" || (owned && !closed))
                    ? account
                      ? (text, model, cells) =>
                          chat.current?.ask(text, selectedArea(model, cells)) ?? Promise.resolve(false)
                      : async () => {
                          askSignIn();
                          throw new Error("Sign in to ask Holo.");
                        }
                    : undefined
                }
                onMode={(next) => {
                  if (next !== "edit" || !previewing) setMode(next);
                }}
              />
              {build && !built && build.status !== "building" && (
                <div className="notice">There's nothing here yet, so ask Holo in the chat to start building.</div>
              )}
            </div>
            {center !== "model" && !sheeted && <div className="pane">{panel}</div>}
            {finished && finished === live?.id && publishing && !error && (
              <FinishedCard
                build={live}
                blocks={counts ? blockCount : null}
                publishing={publishing}
                onGif={() => setFilmBuild(live)}
                onClose={() => setFinished(null)}
              />
            )}
            {error && (
              <div className="pane notice" role="alert">
                <b>{error}</b>
                {locked && <button onClick={askSignIn}>Sign in</button>}
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
              onLive={build?.status === "building" && !following ? () => scrub(last) : undefined}
              blocks={counts ? blockCount : null}
              spaceKey={mode !== "walk"}
            />
          )}
        </div>
      </main>
      {filmBuild && <FilmExport build={filmBuild} onClose={() => setFilmBuild(null)} />}
      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
    </div>
  );
}
