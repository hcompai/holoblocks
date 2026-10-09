import { CopyIcon, DownloadSimpleIcon, ShareNetworkIcon, XIcon, XLogoIcon } from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { BlockLoader } from "./BlockLoader";
import type { Build } from "./model";
import { FilmRenderer } from "./film";
import { encodeGif } from "./filmGif";
import { PHONE } from "./usePhone";
import {
  FILM_ASPECTS,
  FILM_SECONDS,
  filmCaption,
  filmFilename,
  type FilmAspect,
  type FilmCamera,
  type FilmOptions,
} from "./filmPlan";

/** The long side of the preview and of the GIF. */
const BROWSER_SIDE = 640;
const BROWSER_FPS = 20;

interface Props {
  /** Frozen at open, including during a live run. */
  build: Build;
  onClose: () => void;
}

function browserOptions(aspect: FilmAspect, seconds: number, branded: boolean, camera: FilmCamera): FilmOptions {
  const { width, height } = FILM_ASPECTS[aspect];
  const scale = BROWSER_SIDE / Math.max(width, height);
  const even = (v: number) => 2 * Math.round((v * scale) / 2);
  return { width: even(width), height: even(height), seconds, fps: BROWSER_FPS, branded, camera };
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

interface ChoiceProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
}

/** One of a few options, as a row of pills. */
function Choice<T extends string | number>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <div className="film-choice">
      <span id={`film-${label}`}>{label}</span>
      <div className="tabs film-tabs" role="radiogroup" aria-labelledby={`film-${label}`}>
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? "active" : ""}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Makes the GIF as soon as the blocks load, and again whenever an option changes. */
export function FilmExport({ build, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<FilmRenderer | null>(null);
  /** The GIF being made; the next waits for it to stop, since both draw with the one renderer. */
  const queue = useRef(Promise.resolve());
  const [aspect, setAspect] = useState<FilmAspect>(() => (PHONE.matches ? "1:1" : "16:9"));
  const [seconds, setSeconds] = useState(8);
  const [branded, setBranded] = useState(true);
  const [camera, setCamera] = useState<FilmCamera>("follow");
  const [ready, setReady] = useState(false);
  const [blocks, setBlocks] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const caption = filmCaption(build, blocks, branded);
  const size = browserOptions(aspect, seconds, branded, camera);
  const canShare = !!file && !!navigator.share && !!navigator.canShare?.({ files: [file] });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    let current = true;
    let engine: FilmRenderer | null = null;
    setReady(false);
    setFile(null);
    setError("");
    setNotice("");
    const timer = setTimeout(() => {
      current = false;
      engine?.dispose();
      setError("Loading the build timed out. Retry.");
    }, 45000);
    try {
      engine = new FilmRenderer(build, canvas.current!);
      renderer.current = engine;
      const prepared = engine;
      void prepared
        .prepare()
        .then(() => {
          if (!current) return;
          setBlocks(prepared.blocks);
          setReady(true);
        })
        .catch((e: unknown) => {
          if (current) setError(e instanceof Error ? e.message : "Could not load this build.");
        })
        .finally(() => clearTimeout(timer));
    } catch (e) {
      clearTimeout(timer);
      setError(e instanceof Error ? e.message : "WebGL is unavailable in this browser.");
    }
    return () => {
      current = false;
      clearTimeout(timer);
      engine?.dispose();
      renderer.current = null;
    };
  }, [build, retry]);

  /** The finished build as the film ends. */
  const preview = () => {
    const r = renderer.current;
    if (!r) return;
    r.configure(browserOptions(aspect, seconds, branded, camera));
    r.render(r.frames - 1).catch((e: unknown) => {
      if (renderer.current === r) setError(e instanceof Error ? e.message : "Could not draw the preview.");
    });
  };

  const generate = async (signal: AbortSignal) => {
    const r = renderer.current;
    if (signal.aborted || !r) return;
    setProgress(0);
    setFile(null);
    setError("");
    setNotice("");
    try {
      r.configure(browserOptions(aspect, seconds, branded, camera));
      const blob = await encodeGif(r, BROWSER_FPS, signal, setProgress);
      signal.throwIfAborted();
      setFile(new File([blob], filmFilename(build.name, "gif"), { type: "image/gif" }));
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : "Could not make the GIF.");
    } finally {
      if (renderer.current === r) preview();
    }
  };

  useEffect(() => {
    if (!ready) return;
    preview();
    const controller = new AbortController();
    queue.current = queue.current.then(() => generate(controller.signal));
    return () => controller.abort();
  }, [ready, aspect, seconds, branded, camera]);

  const share = async () => {
    if (!file || !canShare) return;
    setNotice("");
    try {
      await navigator.share({ files: [file], title: build.name, text: caption });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setNotice("Sharing is unavailable here. Download the GIF and attach it to your post.");
      }
    }
  };

  const postOnX = () => {
    if (!file || !url) return;
    Object.assign(document.createElement("a"), { href: url, download: file.name }).click();
    window.open(
      `https://x.com/intent/tweet?${new URLSearchParams({ text: caption })}`,
      "_blank",
      "noopener,noreferrer",
    );
    setNotice("GIF downloaded. Drop it into your post on X.");
  };

  const percent = Math.round(progress * 100);

  return (
    <dialog className="film-dialog" ref={dialog} aria-labelledby="film-title" onCancel={onClose}>
      <div className="film-heading">
        <div>
          <h2 id="film-title">Share the build</h2>
          <p>Turn the timeline into a looping GIF.</p>
        </div>
        <button className="icon-button" aria-label="Close export" onClick={onClose}>
          <XIcon size={20} />
        </button>
      </div>
      <div className="film-layout">
        <div
          className="film-preview"
          style={{
            aspectRatio: `${size.width}/${size.height}`,
            width: `min(100%, ${(68 * size.width) / size.height}dvh)`,
          }}
          aria-busy={!url}
        >
          <canvas ref={canvas} hidden={!!url || !ready} aria-label="Film preview" />
          {url && <img src={url} alt={`Film of ${build.name}`} />}
          {!ready && (error ? <span>Preview unavailable</span> : <BlockLoader label="Loading the blocks…" />)}
        </div>
        <div className="film-controls">
          <p className="film-context">
            {build.status === "building" ? "A snapshot of the build in progress. " : "A snapshot of this build. "}
            Replays its saved steps, not Holo’s working history.
          </p>
          <div className="film-generation" aria-live="polite">
            {file && url ? (
              <>
                <div className="film-actions">
                  <button className="film-primary" onClick={postOnX}>
                    <XLogoIcon size={16} /> Post on X
                  </button>
                  {canShare && (
                    <button className="film-secondary" onClick={share}>
                      <ShareNetworkIcon size={16} /> Share…
                    </button>
                  )}
                  <a className="film-secondary" href={url} download={file.name}>
                    <DownloadSimpleIcon size={16} /> Download
                  </a>
                </div>
                <p className="small muted">
                  {size.width} × {size.height} · {seconds}s · {megabytes(file.size)}
                </p>
              </>
            ) : error ? (
              <div role="alert" className="film-error">
                {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              </div>
            ) : (
              <button className="progress-button" disabled style={{ "--progress": `${percent}%` } as CSSProperties}>
                {ready ? `Making the GIF… ${percent}%` : "Loading the blocks…"}
              </button>
            )}
          </div>
          <Choice
            label="Camera"
            value={camera}
            options={[
              { value: "follow", label: "Follow" },
              { value: "orbit", label: "Orbit" },
              { value: "fixed", label: "Fixed" },
            ]}
            onChange={setCamera}
          />
          <Choice
            label="Format"
            value={aspect}
            options={(Object.keys(FILM_ASPECTS) as FilmAspect[]).map((key) => ({
              value: key,
              label: key,
              title: FILM_ASPECTS[key].label,
            }))}
            onChange={setAspect}
          />
          <Choice
            label="Duration"
            value={seconds}
            options={FILM_SECONDS.map((s) => ({ value: s, label: `${s}s` }))}
            onChange={setSeconds}
          />
          <label className="film-branding">
            <input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} />H logo
          </label>
          <label className="film-caption">
            Caption
            <textarea value={caption} readOnly rows={3} onFocus={(e) => e.target.select()} />
          </label>
          <button
            className="film-copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(caption);
                setNotice("Caption copied.");
              } catch {
                setNotice("Select the caption above and copy it manually.");
              }
            }}
          >
            <CopyIcon size={16} /> Copy
          </button>
          {notice && (
            <p className="small" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
