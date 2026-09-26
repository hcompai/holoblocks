import * as THREE from "three";
import { api, type Palette, type Tex, type TextureSheet } from "./api";

export const TILE = 32;
/** Gutter of repeated edge texels around each tile, so mipmaps never blend neighbouring tiles. */
const PAD = 16;
const CELL = TILE + 2 * PAD;

export interface Atlas {
  texture: THREE.Texture;
  /** [u0, v0, u1, v1] of a tile. */
  uv(key: string): [number, number, number, number];
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/** Draw a texture from the sheet, tinted when asked. */
function drawTile(ctx: CanvasRenderingContext2D, source: CanvasImageSource, [sx, sy, size]: number[], x: number, y: number, tint?: string) {
  if (!tint) {
    ctx.drawImage(source, sx, sy, size, size, x, y, TILE, TILE);
    return;
  }
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = TILE;
  const t = tmp.getContext("2d")!;
  t.drawImage(source, sx, sy, size, size, 0, 0, TILE, TILE);
  t.globalCompositeOperation = "multiply";
  t.fillStyle = tint;
  t.fillRect(0, 0, TILE, TILE);
  t.globalCompositeOperation = "destination-in";
  t.drawImage(source, sx, sy, size, size, 0, 0, TILE, TILE);
  ctx.drawImage(tmp, x, y);
}

function padTile(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, x: number, y: number) {
  const end = TILE - 1;
  ctx.drawImage(src, x, y, 1, TILE, x - PAD, y, PAD, TILE);
  ctx.drawImage(src, x + end, y, 1, TILE, x + TILE, y, PAD, TILE);
  ctx.drawImage(src, x - PAD, y, CELL, 1, x - PAD, y - PAD, CELL, PAD);
  ctx.drawImage(src, x - PAD, y + end, CELL, 1, x - PAD, y + TILE, CELL, PAD);
}

/** Top-left pixel of a texture in the sheet. */
export function sheetOrigin(sheet: TextureSheet, name: string): [number, number] {
  const i = sheet.names.indexOf(name);
  if (i < 0) throw new Error(`missing texture ${name}`);
  return [(i % sheet.columns) * sheet.tile, Math.floor(i / sheet.columns) * sheet.tile];
}

export async function buildAtlas(palette: Palette): Promise<Atlas> {
  const [sheet, image] = await Promise.all([api.textureSheet(), loadImage(api.textureSheetUrl)]);
  const draw = (ctx: CanvasRenderingContext2D, name: string, x: number, y: number, tint?: string) =>
    drawTile(ctx, image, [...sheetOrigin(sheet, name), sheet.tile], x, y, tint);

  const keys = textureKeys(palette);
  const columns = Math.ceil(Math.sqrt(keys.length));
  const rows = Math.ceil(keys.length / columns);
  const canvas = document.createElement("canvas");
  canvas.width = columns * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext("2d")!;
  const slots = new Map<string, number>();
  keys.forEach((tex, i) => {
    const x = (i % columns) * CELL + PAD;
    const y = Math.floor(i / columns) * CELL + PAD;
    slots.set(texKey(tex), i);
    if (typeof tex === "string") draw(ctx, tex, x, y);
    else if (tex.length === 2) draw(ctx, tex[0], x, y, tex[1]);
    else {
      draw(ctx, tex[0], x, y);
      draw(ctx, tex[1], x, y, tex[2]);
    }
    padTile(ctx, canvas, x, y);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  const lo = PAD / CELL;
  const hi = (PAD + TILE) / CELL;
  return {
    texture,
    uv(key) {
      const i = slots.get(key) ?? 0;
      const c = i % columns;
      const r = Math.floor(i / columns);
      return [(c + lo) / columns, 1 - (r + hi) / rows, (c + hi) / columns, 1 - (r + lo) / rows];
    },
  };
}
