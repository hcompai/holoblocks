import type { Message, RenderRequest } from "./model";

export type View = Omit<RenderRequest, "request" | "revision">;

const SIDES = ["front", "front-right", "right", "back-right", "back", "back-left", "left", "front-left"];

const numbers = (value: unknown, n: number): number[] | null =>
  Array.isArray(value) && value.length === n && value.every(Number.isFinite) ? value : null;

const number = (value: unknown) => value === undefined || Number.isFinite(value);

/** The view a `look` call asks for, or why it cannot be drawn. */
export function view(args: Record<string, unknown> = {}): View | string {
  const { angle, pitch, zoom, box, eye } = args;
  const corners = box === undefined ? null : numbers(box, 6);
  const at = eye === undefined ? null : numbers(eye, 3);
  if (box !== undefined && !corners) return "`box` is six numbers: [x0, y0, z0, x1, y1, z1].";
  if (eye !== undefined && !at) return "`eye` is three numbers: [x, y, z].";
  if (!number(angle) || !number(pitch) || !number(zoom)) return "`angle`, `pitch` and `zoom` are numbers.";
  const up = (pitch as number | undefined) ?? (at ? 0 : 30);
  const magnified = (zoom as number | undefined) ?? 1;
  const low = at ? -90 : 0;
  if (up < low || up > 90 || magnified < 1 || magnified > 8)
    return `\`pitch\` goes from ${low} to 90 and \`zoom\` from 1 to 8; got ${up} and ${magnified}.`;
  const around = at
    ? null
    : angle !== undefined
      ? (((angle as number) % 360) + 360) % 360
      : pitch !== undefined
        ? 0
        : null;
  const [x0, y0, z0, x1, y1, z1] = corners ?? [];
  return {
    box: corners
      ? [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)]
      : null,
    angle: around,
    pitch: up,
    zoom: magnified,
    eye: at,
  };
}

/** The text beside a render, naming what it shows. */
export function caption({ box, angle, pitch, zoom, eye, revision }: RenderRequest, blocks: number): string {
  const magnified = zoom === 1 ? "" : `, zoom ${zoom}x`;
  let shown = `3/4 front-right, 3/4 back-left, front, and top (back at the top)${magnified}.`;
  if (eye) {
    const tilt = pitch ? `, tilted ${Math.abs(pitch)} degrees ${pitch > 0 ? "down" : "up"}` : "";
    shown = `one wide view from a camera at x ${eye[0]}, y ${eye[1]}, z ${eye[2]}, turned to the middle${tilt}${magnified}.`;
  } else if (angle !== null) {
    shown = `one view from ${angle} degrees around (${SIDES[Math.round(angle / 45) % 8]}), ${pitch} degrees up${magnified}.`;
  }
  const text = box
    ? `Close-up of x ${box[0]}-${box[3]}, y ${box[1]}-${box[4]}, z ${box[2]}-${box[5]}, showing only the blocks inside: ${shown}`
    : `The render: ${shown}`;
  return `Revision ${revision.slice(0, 8)}, ${blocks} blocks. ${text}`;
}

export const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Recover a completed inspection from its public tool result; the follower resolves its revision prefix. */
export function inspected(
  request: string | null | undefined,
  args: Record<string, unknown> | undefined,
  result: Message,
): RenderRequest | null {
  const revision = result.text.match(/^Revision ([a-f0-9]{8}),/)?.[1];
  const wanted = view(args);
  return request && revision && result.images.length && typeof wanted !== "string"
    ? { request, revision, ...wanted }
    : null;
}
