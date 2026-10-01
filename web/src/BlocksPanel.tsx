import { useEffect, useState } from "react";
import { type BlockInfo, type Palette, type Tex, TEXTURE_SHEET_URL, textureSheet, type TextureSheet } from "./model";
import { sheetOrigin } from "./atlas";

interface Props {
  counts: Map<string, number> | null;
  palette: Promise<Palette>;
}

const SWATCH = 16;

const swatchTex = (tex: Palette[string]["tex"]): Tex =>
  typeof tex === "string" || Array.isArray(tex) ? tex : (tex.side ?? tex.top ?? tex.bottom ?? "");

const texName = (tex: Tex) => (typeof tex === "string" ? tex : tex[0]);

/** A block's texture, from its side else its top, as a small square. */
export function BlockSwatch({
  sheet,
  info,
  size = SWATCH,
}: {
  sheet: TextureSheet;
  info: BlockInfo | undefined;
  size?: number;
}) {
  const tex = info ? texName(swatchTex(info.tex)) : "";
  return tex ? <Swatch sheet={sheet} name={tex} size={size} /> : null;
}

function Swatch({ sheet, name, size }: { sheet: TextureSheet; name: string; size: number }) {
  const scale = size / sheet.tile;
  const [x, y] = sheetOrigin(sheet, name);
  return (
    <span
      className="swatch"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${TEXTURE_SHEET_URL})`,
        backgroundPosition: `${-x * scale}px ${-y * scale}px`,
        backgroundSize: `${sheet.columns * size}px auto`,
      }}
    />
  );
}

export function BlocksPanel({ counts: byName, palette }: Props) {
  const [blocks, setBlocks] = useState<Palette>({});
  const [sheet, setSheet] = useState<TextureSheet | null>(null);
  useEffect(() => {
    palette.then(setBlocks);
    textureSheet().then(setSheet);
  }, [palette]);

  const counts = byName ? [...byName.entries()].sort((a, b) => b[1] - a[1]) : [];
  const total = counts.reduce((n, [, c]) => n + c, 0);

  return (
    <div className="parts">
      <div className="parts-head">
        <b>{total.toLocaleString()} blocks</b>
        <span className="muted">{counts.length} block types</span>
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
          {counts.map(([name, n]) => (
            <tr key={name}>
              <td className="qty">{n.toLocaleString()}×</td>
              <td>
                {sheet && <BlockSwatch sheet={sheet} info={blocks[name]} />}
                {name.replaceAll("_", " ")}
              </td>
              <td className="id">{name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
