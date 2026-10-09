import { Annotation, type AnnotationContext, type VisualInstruction } from "./Annotation";
import {
  ArrowsClockwiseIcon,
  CrosshairSimpleIcon,
  VideoCameraIcon,
  LockSimpleIcon,
  PauseIcon,
  PencilSimpleIcon,
  PersonSimpleWalkIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { BlockLoader } from "./BlockLoader";
import { ACTION_KEYS, type Action, blockLabel, EditBar, EditPanel } from "./EditPanel";
import type { Edits } from "./edits";
import type { Build, Palette } from "./model";
import { BlockScene, type PlacementProgress, typing, type View } from "./scene";
import { Shortcuts } from "./Shortcuts";
import type { Activity } from "./session";
import { useTheme } from "./theme";
import { Thinking } from "./Thinking";
import type { Hit, Vec3 } from "./voxels";
import { WalkHud } from "./WalkHud";
import { useWalkFullscreen } from "./useWalkFullscreen";
import { PlacementSoundToggle } from "./PlacementSound";

/** Hand edits come in bursts; the library tile waits for a pause. */
const THUMBNAIL_IDLE_MS = 1500;
/** Pointer travel, in pixels, past which a press is a drag rather than a click. */
const CLICK_SLOP = 5;
const NONE: Vec3[] = [];

const VIEWS: { id: View; label: string }[] = [
  { id: "iso", label: "3/4" },
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];

/** A camera view to frame; a fresh object reframes even when the view is unchanged. */
export interface Framing {
  view: View;
}

/** Orbit and look, select and change blocks, or walk through the build. */
export type Mode = "view" | "edit" | "walk";

interface ControlsProps {
  framing: Framing;
  spin: boolean;
  followCamera: boolean;
  /** Shown while the build is live or replaying, the only times the camera follows it. */
  onFollowCamera?: (follow: boolean) => void;
  mode: Mode;
  canEdit: boolean;
  /** Why Edit is unavailable and what unlocks it. */
  editHint?: string;
  /** The build has blocks, so it can be edited or walked through. */
  built: boolean;
  onFrame: (framing: Framing) => void;
  onSpin: (spin: boolean) => void;
  onMode: (mode: Mode) => void;
}

export function ViewControls({
  framing,
  spin,
  followCamera,
  onFollowCamera,
  mode,
  canEdit,
  editHint,
  built,
  onFrame,
  onSpin,
  onMode,
}: ControlsProps) {
  const hintId = useId();
  const blocked = built && !canEdit && mode !== "edit";
  const hint = blocked && editHint;
  const toggle = (next: Mode) => onMode(mode === next ? "view" : next);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="view-toggle" aria-label="View controls" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <XIcon size={16} weight="bold" /> : <SlidersHorizontalIcon size={16} weight="bold" />}
      </button>
      <div className={open ? "tabs view-tabs open" : "tabs view-tabs"}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={!followCamera && framing.view === v.id ? "active" : ""}
            aria-pressed={!followCamera && framing.view === v.id}
            onClick={() => onFrame({ view: v.id })}
          >
            {v.label}
          </button>
        ))}
        <button aria-label="Reset view" title="Reset view" onClick={() => onFrame({ view: "iso" })}>
          <CrosshairSimpleIcon size={14} weight="bold" />
        </button>
        <span className="tabs-sep" />
        {onFollowCamera && (
          <button
            className={followCamera ? "active" : ""}
            aria-pressed={followCamera}
            disabled={mode !== "view"}
            title="Frame each step during builds and replay. Drag or zoom to take control."
            onClick={() => onFollowCamera(!followCamera)}
          >
            <VideoCameraIcon size={14} weight="bold" />
            <span className="button-label">Follow</span>
          </button>
        )}
        <button className={spin ? "active" : ""} aria-pressed={spin} onClick={() => onSpin(!spin)}>
          <ArrowsClockwiseIcon size={14} weight="bold" />
          <span className="button-label">Spin</span>
        </button>
        {built && (
          <>
            <span className="tabs-sep" />
            <button
              className={mode === "edit" ? "active" : ""}
              aria-pressed={mode === "edit"}
              disabled={blocked}
              aria-describedby={hint ? hintId : undefined}
              title={
                canEdit
                  ? "Select blocks to replace, move or delete them"
                  : (editHint ?? "Blocks can be edited once Holo is done")
              }
              onClick={() => toggle("edit")}
            >
              {blocked ? <LockSimpleIcon size={14} weight="bold" /> : <PencilSimpleIcon size={14} weight="bold" />}
              <span className="button-label">Edit</span>
            </button>
            <button
              className={mode === "walk" ? "active" : ""}
              aria-pressed={mode === "walk"}
              title="Walk through the build: WASD and the mouse"
              onClick={() => toggle("walk")}
            >
              <PersonSimpleWalkIcon size={14} weight="bold" />
              <span className="button-label">Walk</span>
            </button>
          </>
        )}
        <Shortcuts />
        {built && <PlacementSoundToggle />}
      </div>
      {hint && (
        <div className="view-notes">
          <p id={hintId} className="edit-availability" role="status">
            {hint}
          </p>
        </div>
      )}
    </>
  );
}

interface Props {
  onAnnotate?: (instruction: VisualInstruction) => Promise<void>;
  /** The build as shown, with this browser's hand edits. */
  build: Build | null;
  step: number;
  framing: Framing;
  spin: boolean;
  followCamera?: boolean;
  onFollowCamera?: (follow: boolean) => void;
  /** Called with a thumbnail once a finished build is drawn to its last step. */
  onThumbnail: (png: Blob) => void;
  palette: Promise<Palette>;
  /** Block counts by name of what is shown, once meshed. */
  onCounts: (counts: Map<string, number> | null) => void;
  scene: RefObject<BlockScene | null>;
  /** What is opening while the model is not meshed yet. */
  loading: string | null;
  /** Live activity before the first blocks arrive. */
  thinking: Activity | null;
  placementSpeed?: number;
  onPlacing?: (placing: boolean) => void;
  /** The model could not be meshed. */
  failed: boolean;
  onFailed: (failed: boolean) => void;
  mode: Mode;
  edits: Edits;
  /** Send `text` to Holo about the selected blocks of `model`; whether it took it. */
  onAsk?: (text: string, model: Build, cells: { at: Vec3; block: string }[]) => Promise<boolean>;
  onMode: (mode: Mode) => void;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (v: Vec3, by: number): Vec3 => [v[0] * by || 0, v[1] * by || 0, v[2] * by || 0];

export function Viewer(props: Props) {
  const { build, step, framing, spin, onThumbnail, palette, onCounts, scene, loading, thinking, failed, onFailed } =
    props;
  const { mode, edits, onMode } = props;
  const walkScreen = useWalkFullscreen(mode === "walk");
  const [annotation, setAnnotation] = useState<{ image: Blob; context: AnnotationContext } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [annotationError, setAnnotationError] = useState("");
  const captureKey = useRef("");
  captureKey.current = `${build?.id}:${build?.revision}:${step}`;
  useEffect(() => {
    setAnnotation(null);
    setAnnotationError("");
  }, [build?.id]);
  const capture = async () => {
    if (!build || capturing) return;
    const key = captureKey.current;
    const context = { build: build.id, revision: build.revision, step };
    setCapturing(true);
    setAnnotationError("");
    try {
      // Finish only the browser's reveal so removal marks do not target temporary/ghost geometry.
      scene.current?.skipPlacement();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const image = await scene.current?.image();
      if (captureKey.current !== key) throw new Error("The model changed. Try Annotate again.");
      if (!image) throw new Error("The model is not ready. Try again.");
      setAnnotation({ image, context });
    } catch (error) {
      setAnnotationError(error instanceof Error ? error.message : "Could not capture this view.");
    } finally {
      setCapturing(false);
    }
  };
  const container = useRef<HTMLDivElement>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const [drawn, setDrawn] = useState<string | null>(null);
  /** The build drawn at least once; it stays up while its next revision is meshed. */
  const [opened, setOpened] = useState<string | null>(null);
  const [used, setUsed] = useState<string[]>([]);
  const [hand, setHand] = useState<string | null>(null);
  const [hover, setHover] = useState<Hit | null>(null);
  const [selected, setSelected] = useState<Vec3[]>(NONE);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const [flying, setFlying] = useState(false);
  const [placement, setPlacement] = useState<PlacementProgress | null>(null);
  const [placementPaused, setPlacementPaused] = useState(false);
  const previous = useRef<{ id: string; revision: string; step: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverFrame = useRef(0);
  const width = build?.width ?? 64;
  const depth = build?.depth ?? 64;
  const last = build ? step >= build.steps.length - 1 : false;
  const editing = mode === "edit";
  const held = hand ?? used[0] ?? "stone";
  const theme = useTheme();

  useEffect(() => {
    const s = new BlockScene(container.current!, palette);
    s.onCounts = (counts) => {
      setUsed([...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name));
      onCounts(counts);
    };
    s.onFailure = () => onFailed(true);
    s.onWalkLock = setLocked;
    s.onFly = setFlying;
    s.onPlacement = (progress) => {
      setPlacement(progress.active ? progress : null);
      if (!progress.active) setPlacementPaused(false);
      props.onPlacing?.(progress.active);
    };
    scene.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    onFailed(false);
    setDrawn(null);
    if (!build) {
      previous.current = null;
      framedBuild.current = null;
      s.show(null);
      onCounts(null);
      return;
    }
    const was = previous.current;
    const same = was?.id === build.id;
    const animate =
      mode === "view" &&
      ((same && step > was.step) || (build.status === "building" && (!same || was.revision !== build.revision)));
    if (animate && build.boxes.length) props.onPlacing?.(true);
    s.setBuildComplete(build.status === "done" && last);
    s.show(build, step, { animate, reset: !same });
    previous.current = { id: build.id, revision: build.revision, step };
    let current = true;
    s.ready.then(() => {
      if (current) {
        setDrawn(build.revision);
        setOpened(build.id);
      }
      if (!current || !build.boxes.length) return;
      if (framedBuild.current !== build.id || (build.status === "building" && s.followingBuild)) {
        framedBuild.current = build.id;
        if (!(build.status === "building" && s.hasBuildCamera)) s.frameView(framing.view, width, depth);
      }
    });
    return () => {
      current = false;
    };
  }, [build?.id, build?.boxes, step]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !selected.length) return;
    const kept = selected.filter((cell) => s.blockAt(cell) !== "air");
    if (kept.length !== selected.length) setSelected(kept);
  }, [build?.boxes, step]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build?.boxes.length || build.status !== "done" || !last) return;
    const version = `${build.id}:${build.revision}`;
    if (thumbnailed.current.has(version)) return;
    let current = true;
    const timer = setTimeout(
      () =>
        s.ready
          .then(() => s.thumbnail())
          .then((png) => {
            if (!current || !png) return;
            thumbnailed.current.add(version);
            onThumbnail(png);
          })
          .catch((error) => console.error("Could not make the thumbnail", error)),
      THUMBNAIL_IDLE_MS,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [build?.id, build?.status, build?.revision, last]);

  useEffect(() => scene.current?.setSpin(spin), [spin]);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.onFollowBuild = props.onFollowCamera ?? null;
    s.setFollowBuild((props.followCamera ?? true) && mode === "view" && !spin);
  }, [props.followCamera, props.onFollowCamera, mode, spin]);
  useEffect(() => scene.current?.setBuildComplete(build?.status === "done" && last), [build?.status, last]);
  useEffect(() => scene.current?.setPlacementSpeed(props.placementSpeed ?? 1), [props.placementSpeed]);

  useEffect(() => scene.current?.setTheme(theme), [theme]);

  useEffect(() => {
    scene.current?.setWalk(mode === "walk");
    if (mode !== "view") scene.current?.skipPlacement();
    if (mode !== "walk") {
      setLocked(false);
      setFlying(false);
    }
    if (!editing) {
      setHover(null);
      setSelected(NONE);
      setBox(null);
    }
  }, [mode]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.userMoved = false;
    s.frameView(framing.view, width, depth);
  }, [framing]);

  useEffect(() => setSelected(NONE), [build?.id]);

  useEffect(
    () => scene.current?.setHighlight(editing && hover && !hover.ground ? hover.cell : null, editing ? selected : NONE),
    [editing, hover, selected],
  );

  useEffect(() => {
    if (mode !== "walk" || locked) return;
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !typing(event)) onMode("view");
    };
    window.addEventListener("keydown", leave);
    return () => window.removeEventListener("keydown", leave);
  }, [mode, locked]);

  const inside = ([x, y, z]: Vec3) =>
    !!build && x >= 0 && y >= 0 && z >= 0 && x < build.width && y < build.height && z < build.depth;

  /** Apply `action` to the selected blocks as one edit; moves follow the view, snapped to the build's axes. */
  const act = (action: Action) => {
    const s = scene.current;
    if (!s || !selected.length || !edits.editable) return;
    if (action === "delete") {
      edits.push({ kind: "set", cells: selected, block: "air" });
      setSelected(NONE);
      return;
    }
    const { right, forward } = s.screenAxes();
    let by: Vec3;
    if (action === "duplicate") {
      const axis = right.findIndex(Boolean);
      const along = selected.map((cell) => cell[axis]);
      by = scale(right, Math.max(...along) - Math.min(...along) + 1);
    } else {
      by = {
        left: scale(right, -1),
        right,
        forward,
        back: scale(forward, -1),
        up: [0, 1, 0] as Vec3,
        down: [0, -1, 0] as Vec3,
      }[action];
    }
    const moved = selected.map((cell) => add(cell, by));
    if (!moved.every(inside)) return;
    edits.push({ kind: action === "duplicate" ? "duplicate" : "move", cells: selected, by });
    setSelected(moved);
  };

  const pick = (block: string) => {
    setHand(block);
    const s = scene.current;
    const cells = selected.filter((cell) => s?.blockAt(cell) !== block);
    if (cells.length && edits.editable) edits.push({ kind: "set", cells, block });
  };

  useEffect(() => {
    if (!editing) return;
    const key = (event: KeyboardEvent) => {
      if (typing(event)) return;
      if ((event.metaKey || event.ctrlKey) && (event.code === "KeyZ" || event.code === "KeyY")) {
        event.preventDefault();
        if (event.code === "KeyY" || event.shiftKey) edits.redo();
        else edits.undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyD" && selected.length) {
        event.preventDefault();
        act("duplicate");
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || !selected.length) return;
      if (event.key === "Escape") return setSelected(NONE);
      const action = ACTION_KEYS[event.key];
      if (!action) return;
      event.preventDefault();
      act(action);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const far = (event: React.MouseEvent) => {
    const start = pointer.current;
    return !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP;
  };

  const pressed = (event: React.PointerEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY };
  };

  /** Shift-drag in edit mode draws a selection box instead of orbiting; runs before the camera sees the press. */
  const boxStart = (event: React.PointerEvent) => {
    if (!editing || !event.shiftKey || event.button !== 0) return;
    scene.current?.setOrbit(false);
    (event.target as Element).setPointerCapture(event.pointerId);
    setBox({ x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY });
  };

  /** Ends a selection box, or places the block in hand on the face right-clicked. */
  const released = (event: React.PointerEvent) => {
    const s = scene.current;
    if (box) {
      s?.setOrbit(true);
      setBox(null);
      if (Math.hypot(event.clientX - box.x0, event.clientY - box.y0) <= CLICK_SLOP) return;
      const within = event.altKey ? s?.cellsIn : s?.cellsSeenIn;
      const inside = within?.call(s, box.x0, box.y0, event.clientX, event.clientY) ?? [];
      const all = new Map([...selected, ...inside].map((cell) => [cell.join(), cell]));
      setSelected([...all.values()]);
      return;
    }
    if (!editing || event.button !== 2 || far(event) || !s || !edits.editable) return;
    const hit = s.pick(event.clientX, event.clientY);
    const cell = hit && add(hit.cell, hit.normal);
    if (cell && inside(cell) && s.blockAt(cell) === "air") edits.push({ kind: "set", cells: [cell], block: held });
  };

  const hovered = (event: React.PointerEvent) => {
    if (box) return setBox({ ...box, x1: event.clientX, y1: event.clientY });
    if (!editing || event.buttons) return;
    const { clientX, clientY } = event;
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => setHover(scene.current?.pick(clientX, clientY) ?? null));
  };

  const clicked = (event: React.MouseEvent) => {
    if (mode === "walk") return scene.current?.lockPointer();
    if (!editing || far(event)) return;
    const hit = scene.current?.pick(event.clientX, event.clientY);
    const cell = hit && !hit.ground ? hit.cell : null;
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      if (!cell) return;
      const others = selected.filter((c) => c.join() !== cell.join());
      setSelected(others.length < selected.length ? others : [...selected, cell]);
    } else setSelected(cell ? [cell] : NONE);
  };

  const names = new Set(selected.map((cell) => scene.current?.blockAt(cell) ?? "air"));
  const label = selected.length === 1 ? blockLabel([...names][0]) : `${selected.length.toLocaleString()} blocks`;
  const shown = !!build && opened === build.id && !failed;
  const pointing = (editing && !!hover && !hover.ground) || (mode === "walk" && !locked);

  return (
    <div
      ref={walkScreen.ref}
      className={walkScreen.fullscreen ? "viewer walk-fullscreen" : "viewer"}
      data-revision={drawn ?? undefined}
      data-placing={placement ? "true" : undefined}
      data-placed={placement?.placed}
      data-placement-total={placement?.total}
    >
      <div
        className="viewer-canvas"
        ref={container}
        style={{ cursor: pointing ? "pointer" : undefined }}
        onPointerDownCapture={boxStart}
        onPointerDown={pressed}
        onPointerMove={hovered}
        onPointerUp={released}
        onPointerCancel={released}
        onPointerLeave={() => setHover(null)}
        onClick={clicked}
      />
      {props.onAnnotate && mode === "view" && !annotation && (
        <div className="annotate-launch">
          <button onClick={capture} disabled={capturing || !(shown && drawn === build?.revision && !failed)}>
            <PencilSimpleIcon size={16} /> {capturing ? "Opening…" : "Annotate"}
          </button>
          {annotationError && (
            <p className="error-text" role="alert">
              {annotationError}
            </p>
          )}
        </div>
      )}
      {annotation && props.onAnnotate && (
        <Annotation {...annotation} onDone={props.onAnnotate} onClose={() => setAnnotation(null)} />
      )}
      {shown && (edits.stale > 0 || edits.hidden > 0) && (
        <div className="edit-notice" role="status">
          {edits.stale > 0 ? (
            <>
              {edits.stale} edit{edits.stale === 1 ? " was" : "s were"} made on an earlier revision of this build.
              <button onClick={edits.reset}>Discard</button>
            </>
          ) : (
            `Your ${edits.hidden} edit${edits.hidden === 1 ? " is" : "s are"} hidden while Holo builds.`
          )}
        </div>
      )}
      {box && <div className="select-box" style={boxStyle(box, container.current)} />}
      {editing && shown && <EditBar edits={edits} hand={held} used={used} selected={selected.length} onPick={pick} />}
      {editing && shown && selected.length > 0 && (
        <EditPanel
          label={label}
          onAction={act}
          onClose={() => setSelected(NONE)}
          onAsk={
            props.onAsk &&
            ((text) =>
              props.onAsk!(
                text,
                build!,
                selected.map((at) => ({ at, block: scene.current?.blockAt(at) ?? "air" })),
              ))
          }
          count={selected.length}
        />
      )}
      {mode === "walk" && shown && (
        <WalkHud
          locked={locked}
          flying={flying}
          fullscreen={walkScreen.fullscreen}
          onFullscreen={walkScreen.toggle}
          onLeave={() => onMode("view")}
        />
      )}
      {placement && mode === "view" && (
        <div className="placement-hud">
          <span>
            Layer {placement.layer}{" "}
            <span className="muted">
              · {placement.placed.toLocaleString()} / {placement.total.toLocaleString()}
            </span>
          </span>
          <button
            aria-label={placementPaused ? "Resume block placement" : "Pause block placement"}
            onClick={() => {
              scene.current?.pausePlacement(!placementPaused);
              setPlacementPaused(!placementPaused);
            }}
          >
            {placementPaused ? <PlayIcon size={12} weight="fill" /> : <PauseIcon size={12} weight="fill" />}
          </button>
          <button onClick={() => scene.current?.skipPlacement()}>Skip</button>
        </div>
      )}
      {failed ? (
        <RenderFailed />
      ) : thinking ? (
        <Thinking
          activity={thinking}
          name={build?.name}
          request={build?.messages.find((message) => message.role === "user")?.text}
          photos={build?.messages.filter((message) => message.role === "user").flatMap((message) => message.images)}
        />
      ) : (
        loading && <BlockLoader label={loading} />
      )}
    </div>
  );
}

/** The selection box in the viewer's own coordinates. */
function boxStyle(box: { x0: number; y0: number; x1: number; y1: number }, within: HTMLElement | null) {
  const origin = within?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return {
    left: Math.min(box.x0, box.x1) - origin.left,
    top: Math.min(box.y0, box.y1) - origin.top,
    width: Math.abs(box.x1 - box.x0),
    height: Math.abs(box.y1 - box.y0),
  };
}

export function RenderFailed() {
  return (
    <div className="notice" role="alert">
      <b>Couldn't render this build</b>
    </div>
  );
}
