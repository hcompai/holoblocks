import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { api, type Build, type Palette } from "./api";
import { BlockScene, type View } from "./scene";
import type { VoxelWorld } from "./voxels";

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
        <button key={v.id} className={framing.view === v.id ? "active" : ""} onClick={() => onFrame({ view: v.id })}>
          {v.label}
        </button>
      ))}
      <span className="tabs-sep" />
      <button className={spin ? "active" : ""} onClick={() => onSpin(!spin)}>
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
  /** Whether the library already has a thumbnail for this build; undefined until the library loads. */
  hasThumbnail: boolean | undefined;
  renderRequest: string | null;
  palette: Promise<Palette>;
  onWorld: (world: VoxelWorld | null) => void;
}

export function Viewer({ build, step, framing, spin, hasThumbnail, renderRequest, palette, onWorld }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BlockScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const sawBuilding = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const width = build?.width ?? 64;
  const depth = build?.depth ?? 64;

  useEffect(() => {
    const s = new BlockScene(container.current!, palette);
    s.onWorld = (w) => onWorld(w);
    scene.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    if (!build) {
      framedBuild.current = null;
      s.show(null);
      onWorld(null);
      return;
    }
    if (build.status === "building") sawBuilding.current.add(build.id);
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
    if (!s || !build || build.status !== "done" || hasThumbnail === undefined) return;
    if (step < build.steps.length - 1 || thumbnailed.current.has(build.id)) return;
    if (hasThumbnail && !sawBuilding.current.has(build.id)) return;
    thumbnailed.current.add(build.id);
    s.ready.then(async () => {
      const png = await s.thumbnail();
      if (png) await api.putThumbnail(build.id, png);
    });
  }, [build?.id, build?.status, step, hasThumbnail]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build || !renderRequest || answered.current.has(renderRequest)) return;
    answered.current.add(renderRequest);
    s.sheet().then((png) => png && api.putRender(build.id, renderRequest, png));
  }, [renderRequest, build?.id, build?.boxes]);

  useEffect(() => scene.current?.setSpin(spin), [spin]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.userMoved = false;
    s.frameView(framing.view, width, depth);
  }, [framing]);

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={container} />
    </div>
  );
}
