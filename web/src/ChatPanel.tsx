import { ArrowUpIcon, PlusIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Build } from "./model";

const SUGGESTIONS = [
  {
    label: "A hilltop castle",
    prompt:
      "A medieval castle crowning a rocky hill: a tall square keep off center, four round towers of different heights with conical slate roofs, and a gatehouse with a portcullis, a drawbridge and a winding approach road. Weathered curtain walls with crenellations, arrow slits and a wall walk; a courtyard with a well, a stable, market stalls and banners. Outcrops, ivy, scattered pines and a village of timber houses clinging to the slope below.",
  },
  {
    label: "A Japanese temple",
    prompt:
      "A Japanese Buddhist temple beside a koi pond: a two-tier main hall with deep curved eaves, dark timber posts, white plaster walls and a veranda on stone footings, a five-storey pagoda rising behind it, and a red torii gate at the end of a stone path. The pond has irregular rocky banks, a red arched bridge, lily pads and stone lanterns. Cherry trees in bloom, sculpted pines, moss, a raked gravel garden and a bamboo grove at the edge.",
  },
  {
    label: "A village square",
    prompt:
      "A cozy European village square on uneven cobblestones: a stone church with a tall bell tower and a spire, a tiered fountain in the middle, and a ring of crooked timber-framed houses with jettied upper floors, flower boxes, shutters, awnings and chimneys, each a different height and color. Market stalls with crates and barrels, a bakery with a lit window, lanterns on posts, benches, a big shade tree and narrow lanes leading out between the houses.",
  },
  {
    label: "A seaside lighthouse",
    prompt:
      "A tall striped lighthouse on a jagged rocky headland: a tapering round tower with a gallery, a railing and a glowing lantern room under a domed cap, and a keeper's cottage with a slate roof, a chimney and a small garden beside it. Waves breaking on layered cliffs, tide pools, a wooden jetty with a moored rowboat, stairs cut into the rock, wind-bent grass, driftwood, fishing nets and lamps along the path.",
  },
  {
    label: "A gothic cathedral",
    prompt:
      "A soaring gothic cathedral: a western facade with twin spired towers, a great rose window and three deep pointed portals lined with statues, a long nave with tall lancet windows, flying buttresses and pinnacles along both sides, and a central spire over the crossing. Steep dark roofs, gargoyles, a cloister garden with arcades on one side, a small graveyard with yews and lanterns, and a plaza of worn paving with steps up to the doors.",
  },
];

const WAITING_LINES = [
  "Laying the first stones",
  "Studying the photos",
  "Measuring proportions",
  "Sketching the massing",
  "Setting the roofline",
  "Mixing the palette",
  "Squinting at the render",
  "Walking around the model",
  "Checking every join",
  "Hunting for holes",
  "Counting windows",
  "Stacking blocks",
  "Weighing the silhouette",
  "Shaping the ground",
  "Stepping back for a look",
];
const WAITING_MS = 4000;
const RENDER_PX = 240;
const ATTACHMENT_PX = 96;
const MAX_EDGE = 1568;
const MAX_IMAGES = 2;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** The image as a data URL, scaled down to MAX_EDGE on its long side: PNG stays PNG, the rest becomes JPEG. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  const png = file.type === "image/png";
  if (!png) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.9);
}

const failure = (e: unknown) => (e instanceof Error ? e.message : String(e));

function nextLine(current: number): number {
  const next = Math.floor(Math.random() * (WAITING_LINES.length - 1));
  return next >= current ? next + 1 : next;
}

function Waiting() {
  const [line, setLine] = useState(() => Math.floor(Math.random() * WAITING_LINES.length));
  useEffect(() => {
    const timer = setInterval(() => setLine(nextLine), WAITING_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <span key={line} className="shimmer">
      {WAITING_LINES[line]}
    </span>
  );
}

interface Props {
  /** The open build's id, set before the build itself has loaded. */
  buildId: string | null;
  build: Build | null;
  /** The open build could not be loaded. */
  loadFailed: boolean;
  thinking: string;
  hidden: boolean;
  /** Why no message can be sent here, or null when one can. */
  closed: string | null;
  onCreate: (prompt: string, images: string[]) => Promise<void>;
  onSay: (text: string, images: string[]) => Promise<void>;
  onStop: () => Promise<void>;
}

export function ChatPanel(props: Props) {
  const { buildId, build, loadFailed, thinking, hidden, closed, onCreate, onSay, onStop } = props;
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const thought = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const busy = build?.status === "building";
  const ready = !!(text.trim() || images.length) && !sending && (!buildId || (!!build && !busy));
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);

  useEffect(() => {
    if (hidden) return;
    const jump = scrolledFor.current !== (build?.id ?? null);
    scrolledFor.current = build?.id ?? null;
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: jump ? "instant" : "smooth" });
  }, [build?.id, build?.messages.length, busy, hidden]);

  useEffect(() => setFailed(null), [buildId]);

  useEffect(() => {
    thought.current?.scrollTo({ top: thought.current.scrollHeight });
  }, [thinking]);

  useEffect(() => {
    if (!buildId) composer.current?.focus();
  }, [buildId]);

  useLayoutEffect(() => {
    const area = composer.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
  }, [text]);

  const zoom = (src: string, from: HTMLElement) => {
    opener.current = from;
    setZoomed(src);
    lightbox.current?.showModal();
  };

  const attach = async (files: Iterable<File>) => {
    const picked = [...files].filter((f) => IMAGE_TYPES.includes(f.type)).slice(0, MAX_IMAGES - images.length);
    const shrunk = await Promise.allSettled(picked.map(shrink));
    const urls = shrunk.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    setImages((list) => [...list, ...urls].slice(0, MAX_IMAGES));
  };

  const send = async () => {
    if (!ready) return;
    const prompt = text.trim();
    setSending(true);
    setFailed(null);
    try {
      await (buildId ? onSay(prompt, images) : onCreate(prompt, images));
      setText("");
      setImages([]);
    } catch (e) {
      setFailed(`Couldn't send: ${failure(e)}.`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat" hidden={hidden}>
      <div className="chat-log" ref={log}>
        {!buildId ? (
          <div className="chat-intro">
            <h2>What should we build?</h2>
            <p>Describe a structure. The builder writes it in code, block by block, while you watch it rise.</p>
            {!closed && (
              <>
                <div className="label">Try one</div>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => {
                        setText(s.prompt);
                        composer.current?.focus();
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          build?.messages.map((m, i) => (
            <div
              key={i}
              className={`msg ${m.role} ${m.role === "system" && m.text.startsWith("The build stopped") ? "error" : ""}`}
            >
              {m.role === "user" && m.images.length > 0 && (
                <div className="msg-attachments">
                  {m.images.map((src) => (
                    <button key={src} title="Open the image" onClick={(e) => zoom(src, e.currentTarget)}>
                      <img src={src} alt="Attached image" loading="lazy" width={ATTACHMENT_PX} height={ATTACHMENT_PX} />
                    </button>
                  ))}
                </div>
              )}
              <div className="markdown">
                <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
              </div>
              {m.role !== "user" &&
                m.images.map((src) => (
                  <button
                    key={src}
                    className="msg-render"
                    title="Open the render"
                    onClick={(e) => zoom(src, e.currentTarget)}
                  >
                    <img src={src} alt="Render" loading="lazy" width={RENDER_PX} height={RENDER_PX} />
                  </button>
                ))}
            </div>
          ))
        )}
        {busy && (
          <div className="msg assistant thinking">
            <div className="thinking-head">
              <Waiting />
            </div>
            {thinking && (
              <div className="thinking-text markdown" ref={thought}>
                <Markdown remarkPlugins={[remarkGfm]}>{thinking}</Markdown>
              </div>
            )}
          </div>
        )}
      </div>
      <dialog
        ref={lightbox}
        className="lightbox"
        aria-label="Image preview"
        onClick={() => lightbox.current?.close()}
        onClose={() => {
          setZoomed(null);
          opener.current?.focus();
        }}
      >
        {zoomed && <img src={zoomed} alt="" />}
        <form method="dialog">
          <button className="round-button lightbox-close" aria-label="Close" title="Close">
            <XIcon size={16} weight="bold" />
          </button>
        </form>
      </dialog>
      {failed && (
        <p className="chat-error" role="alert">
          {failed}
        </p>
      )}
      {closed ? (
        <p className="gallery-note">{closed}</p>
      ) : loadFailed ? null : (
        <div
          className={`composer ${dropping ? "dropping" : ""}`}
          onClick={(e) => e.target === e.currentTarget && composer.current?.focus()}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            attach(e.dataTransfer.files);
          }}
        >
          {images.length > 0 && (
            <div className="attachments">
              {images.map((src, i) => (
                <div key={i} className="attachment">
                  <button
                    className="attachment-open"
                    title="Open the image"
                    onClick={(e) => zoom(src, e.currentTarget)}
                  >
                    <img src={src} alt={`Attached image ${i + 1}`} />
                  </button>
                  <button
                    className="attachment-remove"
                    aria-label={`Remove image ${i + 1}`}
                    onClick={() => setImages((list) => list.filter((_, j) => j !== i))}
                  >
                    <XIcon size={10} weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={composer}
            rows={2}
            value={text}
            aria-label={buildId ? "Change this build" : "Describe a new build"}
            placeholder={buildId ? "Describe how to change it…" : "Describe what to build…"}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => IMAGE_TYPES.includes(f.type));
              if (!files.length) return;
              e.preventDefault();
              attach(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-tools">
            <button
              className="round-button attach"
              aria-label="Attach images"
              title={`Attach images (up to ${MAX_IMAGES})`}
              disabled={images.length >= MAX_IMAGES}
              onClick={() => picker.current?.click()}
            >
              <PlusIcon size={16} weight="bold" />
            </button>
            <input
              ref={picker}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              multiple
              hidden
              onChange={(e) => {
                attach(e.target.files ?? []);
                e.target.value = "";
              }}
            />
          </div>
          {busy && build ? (
            <button
              className="round-button send stop"
              aria-label="Stop"
              title={stopping ? "Stopping after this step" : "Stop"}
              disabled={stopping}
              onClick={() => {
                setStopping(true);
                onStop().catch((e) => {
                  setStopping(false);
                  setFailed(`Couldn't stop: ${failure(e)}.`);
                });
              }}
            >
              <StopIcon size={14} weight="fill" />
            </button>
          ) : (
            <button className="round-button send" aria-label="Send" title="Send" disabled={!ready} onClick={send}>
              <ArrowUpIcon size={16} weight="bold" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
