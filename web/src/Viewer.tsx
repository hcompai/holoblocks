import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { BlockLoader } from "./BlockLoader";
import type { Build, Palette, RenderRequest } from "./model";
import { BlockScene, type View } from "./scene";
import { useTheme } from "./theme";

const RETRY_MS = 2000;

const VIEWS: { id: View; label: string }[] = [
  { id: "iso", label: "3/4" },
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];

/** A camera view to frame; a fresh object reframes even when the view is unchanged. */
export interface Framing {
  view: View;
}

interface ControlsProps {
  framing: Framing;
  spin: boolean;
  onFrame: (framing: Framing) => void;
  onSpin: (spin: boolean) => void;
}

export function ViewControls({ framing, spin, onFrame, onSpin }: ControlsProps) {
  return (
    <div className="tabs">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className={framing.view === v.id ? "active" : ""}
          aria-pressed={framing.view === v.id}
          onClick={() => onFrame({ view: v.id })}
        >
          {v.label}
        </button>
      ))}
      <span className="tabs-sep" />
      <button className={spin ? "active" : ""} aria-pressed={spin} onClick={() => onSpin(!spin)}>
        <ArrowsClockwiseIcon size={14} weight="bold" />
        Spin
      </button>
    </div>
  );
}

interface Props {
  build: Build | null;
  step: number;
  framing: Framing;
  spin: boolean;
  renderRequest: RenderRequest | null;
  /** Hand the builder the render it asked for, drawn with `blocks` blocks; true once it has it. */
  onRender: (request: RenderRequest, png: Blob, blocks: number) => Promise<boolean>;
  /** Called with a thumbnail once a finished build is drawn to its last step. */
  onThumbnail: (png: Blob) => void;
  /** The live build cannot be confirmed, so renders wait. */
  syncError: string | null;
  palette: Promise<Palette>;
  /** Block counts by name of what is shown, once meshed. */
  onCounts: (counts: Map<string, number> | null) => void;
  scene: RefObject<BlockScene | null>;
  /** What is opening while the model is not meshed yet. */
  loading: string | null;
  /** The model could not be meshed. */
  failed: boolean;
  onFailed: (failed: boolean) => void;
}

export function Viewer(props: Props) {
  const {
    build,
    step,
    framing,
    spin,
    renderRequest,
    onRender,
    onThumbnail,
    syncError,
    palette,
    onCounts,
    scene,
    loading,
    failed,
    onFailed,
  } = props;
  const container = useRef<HTMLDivElement>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const blocks = useRef(0);
  const [drawn, setDrawn] = useState<string | null>(null);
  const width = build?.width ?? 64;
  const depth = build?.depth ?? 64;
  const last = build ? step >= build.steps.length - 1 : false;
  const theme = useTheme();

  useEffect(() => {
    const s = new BlockScene(container.current!, palette);
    s.onCounts = (counts) => {
      blocks.current = [...counts.values()].reduce((a, b) => a + b, 0);
      onCounts(counts);
    };
    s.onFailure = () => onFailed(true);
    scene.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    onFailed(false);
    setDrawn(null);
    if (!build) {
      framedBuild.current = null;
      s.show(null);
      onCounts(null);
      return;
    }
    s.show(build, step);
    let current = true;
    s.ready.then(() => {
      if (current) setDrawn(build.revision);
      if (!build.boxes.length) return;
      if (framedBuild.current !== build.id || (build.status === "building" && !s.userMoved)) {
        framedBuild.current = build.id;
        s.frameView(framing.view, width, depth);
      }
    });
    return () => {
      current = false;
    };
  }, [build?.id, build?.boxes, build?.status, step]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build?.boxes.length || build.status !== "done" || !last) return;
    const version = `${build.id}:${build.revision}`;
    if (thumbnailed.current.has(version)) return;
    let current = true;
    s.ready
      .then(() => s.thumbnail())
      .then((png) => {
        if (!current || !png) return;
        thumbnailed.current.add(version);
        onThumbnail(png);
      })
      .catch((error) => console.error("Could not make the thumbnail", error));
    return () => {
      current = false;
    };
  }, [build?.id, build?.status, build?.revision, last]);

  useEffect(() => {
    const s = scene.current;
    if (!s || syncError || !build || !renderRequest || answered.current.has(renderRequest.request)) return;
    if (build.revision !== renderRequest.revision || !last) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = async () => {
      try {
        await s.ready;
        const png = await s.look(renderRequest);
        if (!active || !png || answered.current.has(renderRequest.request)) return;
        if (await onRender(renderRequest, png, blocks.current)) answered.current.add(renderRequest.request);
        else if (active) timer = setTimeout(answer, RETRY_MS);
      } catch (error) {
        console.error("Could not answer a render request", error);
        if (active) timer = setTimeout(answer, RETRY_MS);
      }
    };
    void answer();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [renderRequest, build?.id, build?.boxes, last, syncError]);

  useEffect(() => scene.current?.setSpin(spin), [spin]);

  useEffect(() => scene.current?.setTheme(theme), [theme]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.userMoved = false;
    s.frameView(framing.view, width, depth);
  }, [framing]);

  return (
    <div className="viewer" data-revision={drawn ?? undefined}>
      <div className="viewer-canvas" ref={container} />
      {failed ? <RenderFailed /> : loading && <BlockLoader label={loading} />}
    </div>
  );
}

export function RenderFailed() {
  return (
    <div className="notice" role="alert">
      <b>Couldn't render this build</b>
    </div>
  );
}
