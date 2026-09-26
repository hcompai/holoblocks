import { useEffect, useRef, useState } from "react";
import { api, type Build, type Palette } from "./api";
import { BlockScene, type View } from "./scene";
import type { VoxelWorld } from "./voxels";

const VIEWS: { id: View; label: string }[] = [
  { id: "iso", label: "3/4" },
  { id: "front", label: "Front" },
  { id: "top", label: "Top" },
];

interface Props {
  build: Build | null;
  step: number;
  renderRequest: string | null;
  palette: Promise<Palette>;
  onWorld: (world: VoxelWorld | null) => void;
}

export function Viewer({ build, step, renderRequest, palette, onWorld }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<BlockScene | null>(null);
  const framedBuild = useRef<string | null>(null);
  const thumbnailed = useRef(new Set<string>());
  const answered = useRef(new Set<string>());
  const [view, setView] = useState<View>("iso");
  const [spin, setSpin] = useState(false);
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
      s.show(null);
      onWorld(null);
      return;
    }
    s.show(build, step);
    s.ready.then(async () => {
      if (!build.boxes.length) return;
      if (framedBuild.current !== build.id || (build.status === "building" && !s.userMoved)) {
        framedBuild.current = build.id;
        s.frameView(view, width, depth);
      }
      if (build.status === "done" && !thumbnailed.current.has(build.id)) {
        thumbnailed.current.add(build.id);
        const png = await s.thumbnail();
        if (png) await api.putThumbnail(build.id, png);
      }
    });
  }, [build?.id, build?.boxes, build?.status, step]);

  useEffect(() => {
    const s = scene.current;
    if (!s || !build || !renderRequest || answered.current.has(renderRequest)) return;
    answered.current.add(renderRequest);
    s.sheet().then((png) => png && api.putRender(build.id, renderRequest, png));
  }, [renderRequest, build?.id, build?.boxes]);

  useEffect(() => scene.current?.setSpin(spin), [spin]);

  const choose = (v: View) => {
    setView(v);
    if (!scene.current) return;
    scene.current.userMoved = false;
    scene.current.frameView(v, width, depth);
  };

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={container} />
      <div className="toolbar">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => choose(v.id)}>
            {v.label}
          </button>
        ))}
        <span className="toolbar-sep" />
        <button className={spin ? "active accent" : ""} onClick={() => setSpin(!spin)}>
          Spin
        </button>
      </div>
      {!build && <div className="viewer-empty">Describe a structure in the chat to start building.</div>}
    </div>
  );
}
