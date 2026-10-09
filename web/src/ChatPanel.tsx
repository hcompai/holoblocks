import { ArrowUpIcon, GitForkIcon, PlusIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Build, Work } from "./model";
import type { Activity } from "./session";
import { label, SUGGESTIONS } from "./suggestions";
import { ThinkingIcon } from "./Thinking";
import { HOLO } from "./holo";

const WHO = "Holo";
const PINNED_PX = 80;
/** How long a live label stays before the next one replaces it, so quick steps never flicker. */
const DWELL_MS = 900;
/** How long a phase lasts before the chat shows its clock. */
const CLOCK_MS = 5000;
const RENDER_PX = 240;
const ATTACHMENT_PX = 96;
const MAX_EDGE = 1568;
const MAX_IMAGES = 2;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
/** The new build's prompt a signed-out visitor typed, kept in this tab across the sign-in round trip. */
const DRAFT = "blockyard.draft";

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

function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `label`, held for at least `DWELL_MS` before it changes. */
function useSteady(label: string): string {
  const [shown, setShown] = useState(label);
  const changed = useRef(0);
  useEffect(() => {
    if (label === shown) return;
    const timer = setTimeout(
      () => {
        changed.current = Date.now();
        setShown(label);
      },
      Math.max(0, changed.current + DWELL_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [label, shown]);
  return shown;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The builder's steps, drawn only while open: a long build reasons for pages. */
function WorkLog({ work, summary }: { work: Work; summary: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="work" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && (
        <ol className="work-steps">
          {work.steps.map((s, i) => (
            <li key={i}>
              {s.reasoning && <p>{s.reasoning}</p>}
              {s.actions.map((a, j) => (
                <span key={j} className="work-action">
                  {a}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

/** What the builder does now; no clock before the first blocks, which take minutes of setup. */
function Live({ activity, early }: { activity: Activity; early: boolean }) {
  const shown = useSteady(activity.label);
  const elapsed = useNow() - activity.since;
  const head = (
    <span className="live-head">
      <ThinkingIcon label={shown} />
      <span key={shown} className="shimmer">
        {shown}
      </span>
      {!early && activity.since > 0 && Number.isFinite(activity.since) && elapsed >= CLOCK_MS && (
        <span className="live-clock">{duration(elapsed)}</span>
      )}
    </span>
  );
  return (
    <div className="msg assistant live" title={`${WHO} is working`}>
      {activity.work ? <WorkLog work={activity.work} summary={head} /> : head}
    </div>
  );
}

export interface ChatHandle {
  ask: (prompt: string, attached: Record<string, Blob>) => Promise<boolean>;
}

interface Props {
  ref?: Ref<ChatHandle>;
  /** The open build's id, set before the build itself has loaded. */
  buildId: string | null;
  build: Build | null;
  /** The open build could not be loaded. */
  loadFailed: boolean;
  activity: Activity | null;
  /** Why no message can be sent here, or how to carry on, or null when a message can be sent. */
  closed: ReactNode;
  onCreate: (prompt: string, images: string[]) => Promise<void>;
  onSay: (text: string, images: string[], attached?: Record<string, Blob>) => Promise<void>;
  onStop: () => Promise<void>;
  /** Start a new build from a copy of this one, changed as asked: one whose session ended. */
  onRemix: (text: string, images: string[], attached?: Record<string, Blob>) => Promise<void>;
  /** Save a private copy of the shown model to change. */
  onFork: () => void;
  /** Set signed out: sending, or forking, asks to sign in, and the composer keeps the message. */
  onSignIn?: () => void;
  /** Shown in place of the composer while an earlier version is previewed. */
  preview?: ReactNode;
  /** Receives the notes and composer under the chat log, which a phone's sheet keeps in view. */
  dockRef?: (dock: HTMLDivElement | null) => void;
}

export function ChatPanel(props: Props) {
  const {
    ref,
    buildId,
    build,
    loadFailed,
    activity,
    closed,
    onCreate,
    onSay,
    onStop,
    onRemix,
    onFork,
    onSignIn,
    preview,
    dockRef,
  } = props;
  const [text, setText] = useState(() => (buildId || build ? "" : (sessionStorage.getItem(DRAFT) ?? "")));
  const [images, setImages] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  /** Messages sent to the builder that its chat does not show yet, each with how many user messages it showed then. */
  const [queued, setQueued] = useState<{ text: string; images: string[]; heard: number }[]>([]);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  /** Whether the log sits at its end, so new lines scroll it and reading earlier ones is left alone. */
  const pinned = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const busy = build?.status === "building";
  /** A build is open, or on its way: messages go to it rather than start one. */
  const changing = !!buildId || !!build;
  /** The builder no longer takes messages here: a change starts a copy of the build. */
  const ended = !!build && !build.open && !busy;
  const typed = !!(text.trim() || images.length);
  const ready = typed && !sending && !closed && !preview && (!changing || !!build?.id);
  const heard = build?.messages.filter((m) => m.role === "user").length ?? 0;
  const waiting = queued.length ? queued.slice(Math.max(0, heard - queued[0].heard)) : queued;
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);

  useEffect(() => {
    if (queued.length && !waiting.length) setQueued([]);
  }, [queued.length, waiting.length]);

  useEffect(() => {
    const jump = scrolledFor.current !== (build?.id ?? null);
    scrolledFor.current = build?.id ?? null;
    if (jump) pinned.current = true;
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight, behavior: jump ? "instant" : "smooth" });
  }, [build?.id, build?.messages.length, busy, waiting.length]);

  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [changing]);

  useEffect(() => {
    if (!buildId) composer.current?.focus();
  }, [buildId]);

  useEffect(() => {
    if (!changing) sessionStorage.removeItem(DRAFT);
  }, []);

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

  /** Hand `prompt` to the builder, even mid-build; whether it took it. */
  const deliver = async (prompt: string, attached: string[], files: Record<string, Blob> = {}) => {
    if (onSignIn) {
      if (!changing) {
        setText(prompt);
        sessionStorage.setItem(DRAFT, prompt);
      }
      onSignIn();
      return false;
    }
    const saying = changing && !ended;
    const entry = { text: prompt, images: attached, heard };
    if (saying) setQueued((list) => [...list, entry]);
    setSending(true);
    setFailed(null);
    try {
      if (ended) await onRemix(prompt, attached, files);
      else if (saying) await onSay(prompt, attached, files);
      else await onCreate(prompt, attached);
      return true;
    } catch (e) {
      setQueued((list) => list.filter((q) => q !== entry));
      setFailed(`Couldn't send: ${failure(e)}.`);
      return false;
    } finally {
      setSending(false);
    }
  };

  useImperativeHandle(ref, () => ({
    ask: (prompt, files) => (sending || !build?.id ? Promise.resolve(false) : deliver(prompt, [], files)),
  }));

  /** The composer empties at once, and gets its text and images back if the builder does not take them. */
  const send = async () => {
    if (!ready) return;
    const prompt = text.trim();
    if (onSignIn) {
      if (!changing) sessionStorage.setItem(DRAFT, prompt);
      return onSignIn();
    }
    const attached = images;
    setText("");
    setImages([]);
    if (await deliver(prompt, attached)) return;
    setText((typed) => typed || prompt);
    setImages((added) => (added.length ? added : attached));
  };

  const lightboxDialog = (
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
  );

  const attachments = (list: string[]) => (
    <div className="msg-attachments">
      {list.map((src) => (
        <button key={src} title="Open the image" onClick={(e) => zoom(src, e.currentTarget)}>
          <img src={src} alt="Attached image" loading="lazy" width={ATTACHMENT_PX} height={ATTACHMENT_PX} />
        </button>
      ))}
    </div>
  );

  const problem = failed && (
    <p className="chat-error" role="alert">
      {failed}
    </p>
  );

  const input = (
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
              <button className="attachment-open" title="Open the image" onClick={(e) => zoom(src, e.currentTarget)}>
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
        rows={changing ? 1 : 2}
        value={text}
        aria-label={ended ? "Remix this build" : changing ? "Change this build" : "Describe a new build"}
        placeholder={changing ? "Ask for a change" : "A castle on a cliff… or drop a photo"}
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
          aria-label="Photos to attach"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            attach(e.target.files ?? []);
            e.target.value = "";
          }}
        />
      </div>
      <span className="composer-model" aria-label={`Model: ${HOLO.name}`}>
        {HOLO.name}
      </span>
      {busy && build && !typed ? (
        <button
          className="round-button send stop"
          aria-label="Stop"
          title={stopping ? "Stopping after this step" : "Stop"}
          disabled={stopping || !build.id}
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
  );

  if (!changing)
    return (
      <div className="home-intro">
        <h1>What should we build?</h1>
        {input}
        {problem}
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} disabled={sending} onClick={() => deliver(s.prompt, [])}>
              {s.label}
            </button>
          ))}
        </div>
        {lightboxDialog}
      </div>
    );

  return (
    <div className="chat">
      <div
        className="chat-log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_PX;
        }}
        onLoadCapture={(e) => {
          if (pinned.current) e.currentTarget.scrollTo({ top: e.currentTarget.scrollHeight });
        }}
      >
        {build?.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.work && <WorkLog work={m.work} summary={`Worked for ${duration(m.work.end - m.work.start)}`} />}
            {m.role === "user" && m.images.length > 0 && attachments(m.images)}
            {m.role === "tool" ? (
              <details className="work">
                <summary>{WHO} checked it</summary>
                <p className="work-steps">{m.text}</p>
              </details>
            ) : (
              <div className="markdown">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {m.role === "user" ? (label(m.text) ?? m.text) : m.text}
                </Markdown>
              </div>
            )}
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
        ))}
        {busy && build && activity && <Live activity={activity} early={!build.boxes.length} />}
        {waiting.map((q, i) => (
          <div key={i} className="msg user queued" title={`Sent: ${WHO} reads it at its next step`}>
            {q.images.length > 0 && attachments(q.images)}
            <div className="markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{q.text}</Markdown>
            </div>
          </div>
        ))}
      </div>
      {lightboxDialog}
      <div className="chat-dock" ref={dockRef}>
        {problem}
        {preview ? (
          <div className="gallery-note preview-note">{preview}</div>
        ) : closed ? (
          <div className="gallery-note">
            {typeof closed === "string" ? <p>{closed}</p> : closed}
            {!!build?.boxes.length &&
              (onSignIn ? (
                <button onClick={onSignIn}>Sign in</button>
              ) : (
                <button onClick={onFork} title="Save a private copy of this build to change">
                  <GitForkIcon size={14} weight="bold" /> {typeof closed === "string" ? "Fork" : "Fork a copy"}
                </button>
              ))}
          </div>
        ) : (
          !loadFailed && input
        )}
      </div>
    </div>
  );
}
