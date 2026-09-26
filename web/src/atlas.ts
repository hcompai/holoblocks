import * as THREE from "three";
import { api, type Palette, type Tex } from "./api";

export const TILE = 32;

export interface Atlas {
  texture: THREE.Texture;
  /** [u0, v0, u1, v1] of a tile, inset by half a texel so neighbours never bleed in. */
  uv(key: string): [number, number, number, number];
  /** CSS background for a tile, for swatches in the UI. */
  swatch(key: string): { backgroundImage: string; backgroundPosition: string; backgroundSize: string };
  canvas: HTMLCanvasElement;
  columns: number;
  rows: number;
}

export const texKey = (tex: Tex): string => (typeof tex === "string" ? tex : tex.join("|"));

function textureKeys(palette: Palette): Tex[] {
  const seen = new Map<string, Tex>();
  for (const info of Object.values(palette)) {
    const faces = typeof info.tex === "string" || Array.isArray(info.tex) ? [info.tex] : Object.values(info.tex);
    for (const face of faces) if (face) seen.set(texKey(face), face);
  }
  return [...seen.values()];
}

function loadImage(name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`missing texture ${name}`));
    img.src = api.textureUrl(name);
  });
}

/** Draw the first (square) frame of a texture, tinted when asked; animated textures are vertical strips. */
function drawTile(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, tint?: string) {
  const size = img.width;
  if (!tint) {
    ctx.drawImage(img, 0, 0, size, size, x, y, TILE, TILE);
    return;
  }
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = TILE;
  const t = tmp.getContext("2d")!;
  t.drawImage(img, 0, 0, size, size, 0, 0, TILE, TILE);
  t.globalCompositeOperation = "multiply";
  t.fillStyle = tint;
  t.fillRect(0, 0, TILE, TILE);
  t.globalCompositeOperation = "destination-in";
  t.drawImage(img, 0, 0, size, size, 0, 0, TILE, TILE);
  ctx.drawImage(tmp, x, y);
}

export async function buildAtlas(palette: Palette): Promise<Atlas> {
  const keys = textureKeys(palette);
  const names = new Set<string>();
  for (const tex of keys) for (const part of typeof tex === "string" ? [tex] : tex) if (!part.startsWith("#")) names.add(part);
  const images = new Map<string, HTMLImageElement>();
  await Promise.all([...names].map(async (n) => images.set(n, await loadImage(n))));

  const columns = Math.ceil(Math.sqrt(keys.length));
  const rows = Math.ceil(keys.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = columns * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext("2d")!;
  const slots = new Map<string, number>();
  keys.forEach((tex, i) => {
    const x = (i % columns) * TILE;
    const y = Math.floor(i / columns) * TILE;
    slots.set(texKey(tex), i);
    if (typeof tex === "string") drawTile(ctx, images.get(tex)!, x, y);
    else if (tex.length === 2) drawTile(ctx, images.get(tex[0])!, x, y, tex[1]);
    else {
      drawTile(ctx, images.get(tex[0])!, x, y);
      drawTile(ctx, images.get(tex[1])!, x, y, tex[2]);
    }
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  const inset = 0.5 / TILE;
  let url: string | null = null;
  return {
    texture,
    canvas,
    columns,
    rows,
    uv(key) {
      const i = slots.get(key) ?? 0;
      const c = i % columns;
      const r = Math.floor(i / columns);
      return [(c + inset) / columns, 1 - (r + 1 - inset) / rows, (c + 1 - inset) / columns, 1 - (r + inset) / rows];
    },
    swatch(key) {
      const i = slots.get(key) ?? 0;
      const c = i % columns;
      const r = Math.floor(i / columns);
      url ??= canvas.toDataURL();
      return {
        backgroundImage: `url(${url})`,
        backgroundPosition: `${-c * 20}px ${-r * 20}px`,
        backgroundSize: `${columns * 20}px ${rows * 20}px`,
      };
    },
  };
}
