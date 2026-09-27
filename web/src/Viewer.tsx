import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { type RefObject, useEffect, useRef } from "react";
import { api, GALLERY, type Build, type Palette, type RenderRequest } from "./api";
import { BlockLoader } from "./BlockLoader";
import { BlockScene, type View } from "./scene";
import { useTheme } from "./theme";

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
  /** Whether the library's thumbnail shows the current blocks; undefined until the library loads. */
  thumbnailFresh: boolean | undefined;
  onThumbnail: () => void;
  renderRequest: RenderRequest | null;
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
    thumbnailFresh,
    onThumbnail,
    renderRequest,
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
  const width = build?.width ?? 64;
  const depth = build?.depth ?? 64;
  const theme = useTheme();

  useEffect(() => {
    const s = new BlockScene(container.current!, palette);
    s.onCounts = (counts) => onCounts(counts);
    s.onFailure = () => onFailed(true);
    scene.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    onFailed(false);
    if (!build) {
      framedBuild.current = null;
      s.show(null);
      onCounts(null);
      return;
    }
    s.show(build, step);
    s.ready.then(() => {
      if (!build.boxes.length) return;
      if (framedBuild.current !== build.id || (build.status === "building" && !s.userMoved)) {
        framedBuild.current = build.id;
        s.frameView(framing.view, width, depth);
      }
    });
  }, [build?.id, build?.boxes, build?.status, step]);

  useEffect(() => {
    const s = scene.current;
    if (GALLERY || !s || !build?.boxes.length || build.status !== "done" || thumbnailFresh !== false) return;
    const version = `${build.id}:${build.updated}`;
    if (step < build.steps.length - 1 || thumbnailed.current.has(version)) return;
    thumbnailed.current.add(version);
    s.ready.then(async () => {
      const png = await s.thumbnail();
      if (png && (await api.putThumbnail(build.id, png)).ok) onThumbnail();
    });
  }, [build?.id, build?.status, build?.updated, step, thumbnailFresh]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build || !renderRequest || answered.current.has(renderRequest.request)) return;
    answered.current.add(renderRequest.request);
    s.look(renderRequest).then((png) => png && api.putRender(build.id, renderRequest.request, png));
  }, [renderRequest, build?.id, build?.boxes]);

  useEffect(() => scene.current?.setSpin(spin), [spin]);

  useEffect(() => scene.current?.setTheme(theme), [theme]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.userMoved = false;
    s.frameView(framing.view, width, depth);
  }, [framing]);

  return (
    <div className="viewer">
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
