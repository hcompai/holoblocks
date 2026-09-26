import { useEffect, useState } from "react";
import type { Palette, Tex } from "./api";
import type { VoxelWorld } from "./voxels";

interface Props {
  world: VoxelWorld | null;
  palette: Promise<Palette>;
}

const swatchTex = (tex: Palette[string]["tex"]): Tex =>
  typeof tex === "string" || Array.isArray(tex) ? tex : (tex.side ?? tex.top ?? tex.bottom ?? "");

const texName = (tex: Tex) => (typeof tex === "string" ? tex : tex[0]);

export function BlocksPanel({ world, palette }: Props) {
  const [blocks, setBlocks] = useState<Palette>({});
  useEffect(() => {
    palette.then(setBlocks);
  }, [palette]);

  const counts = world ? [...world.counts().entries()].sort((a, b) => b[1] - a[1]) : [];
  const total = counts.reduce((n, [, c]) => n + c, 0);

  return (
    <div className="parts">
      <div className="parts-head">
        <b>{total.toLocaleString()} blocks</b>
        <span className="muted">{counts.length} block types, ground not counted</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Qty</th>
            <th>Block</th>
            <th>Id</th>
          </tr>
        </thead>
        <tbody>
          {counts.map(([name, n]) => {
            const info = blocks[name];
            const tex = info ? texName(swatchTex(info.tex)) : "";
            return (
              <tr key={name}>
                <td className="qty">{n.toLocaleString()}×</td>
                <td>
                  {tex && <img className="swatch" src={`/textures/${tex}.png`} alt="" />}
                  {name.replaceAll("_", " ")}
                </td>
                <td className="muted">{name}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
