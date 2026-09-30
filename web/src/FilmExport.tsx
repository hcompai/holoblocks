import { CopyIcon, DownloadSimpleIcon, ShareNetworkIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BlockLoader } from "./BlockLoader";
import type { Build } from "./model";
import { FilmRenderer } from "./film";
import { encodeGif } from "./filmGif";
import { FILM_ASPECTS, FILM_SECONDS, filmCaption, filmFilename, type FilmAspect, type FilmOptions } from "./filmPlan";

/** The long side of the preview and of the GIF. */
const BROWSER_SIDE = 640;
const BROWSER_FPS = 20;

interface Props {
  /** Frozen at open, including during a live run. */
  build: Build;
  onClose: () => void;
}

function browserOptions(aspect: FilmAspect, seconds: number, branded: boolean): FilmOptions {
  const { width, height } = FILM_ASPECTS[aspect];
  const scale = BROWSER_SIDE / Math.max(width, height);
  const even = (v: number) => 2 * Math.round((v * scale) / 2);
  return { width: even(width), height: even(height), seconds, fps: BROWSER_FPS, branded };
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function FilmExport({ build, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<FilmRenderer | null>(null);
  const job = useRef<AbortController | null>(null);
  const [aspect, setAspect] = useState<FilmAspect>("16:9");
  const [seconds, setSeconds] = useState(8);
  const [branded, setBranded] = useState(true);
  const [ready, setReady] = useState(false);
  const [blocks, setBlocks] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const caption = filmCaption(build, blocks, branded);
  const size = browserOptions(aspect, seconds, branded);
  const canShare = !!file && !!navigator.canShare?.({ files: [file] });
  const update = <T,>(set: (value: T) => void, value: T) => {
    set(value);
    setFile(null);
  };

  useEffect(() => {
    dialog.current?.showModal();
    return () => job.current?.abort();
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
      job.current?.abort();
      engine?.dispose();
      renderer.current = null;
    };
  }, [build, retry]);

  /** The finished build as the film ends. */
  const preview = () => {
    const r = renderer.current;
    if (!r) return;
    r.configure(browserOptions(aspect, seconds, branded));
    r.render(r.frames - 1).catch((e: unknown) => {
      if (renderer.current === r) setError(e instanceof Error ? e.message : "Could not draw the preview.");
    });
  };

  useEffect(() => {
    if (ready) preview();
  }, [ready, aspect, seconds, branded]);

  const generate = async () => {
    const r = renderer.current;
    if (!r || !ready || busy) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setStatus("");
    setFile(null);
    setError("");
    setNotice("");
    try {
      r.configure(browserOptions(aspect, seconds, branded));
      const blob = await encodeGif(r, BROWSER_FPS, controller.signal, (value) => {
        setProgress(value);
        setStatus(`Creating GIF… ${Math.round(value * 100)}%`);
      });
      controller.signal.throwIfAborted();
      setFile(new File([blob], filmFilename(build.name, "gif"), { type: "image/gif" }));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not make the GIF.");
    } finally {
      if (renderer.current === r) preview();
      if (job.current === controller) {
        job.current = null;
        setBusy(false);
      }
    }
  };

  const share = async () => {
    if (!file || !canShare) return;
    try {
      await navigator.share({ files: [file], title: build.name, text: caption });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setNotice("Sharing is unavailable here. Download the GIF and attach it to your post.");
      }
    }
  };

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
          aria-busy={!ready || busy}
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
          <fieldset disabled={busy}>
            <legend className="sr-only">Film settings</legend>
            <label>
              Format
              <select value={aspect} onChange={(e) => update(setAspect, e.target.value as FilmAspect)}>
                {Object.entries(FILM_ASPECTS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Duration
              <select value={seconds} onChange={(e) => update(setSeconds, Number(e.target.value))}>
                {FILM_SECONDS.map((s) => (
                  <option key={s} value={s}>
                    {s} seconds
                  </option>
                ))}
              </select>
            </label>
            <label className="film-branding">
              <input type="checkbox" checked={branded} onChange={(e) => update(setBranded, e.target.checked)} />H
              Company logo
            </label>
          </fieldset>
          <p className="small muted">The build rises step by step, then the finished model takes a full turn.</p>
          <div className="film-generation" aria-live="polite">
            {busy ? (
              <>
                <progress value={progress} max={1} aria-label="Film progress" />
                <div className="film-progress-row">
                  <span>{status || "Starting…"}</span>
                  <button
                    onClick={() => {
                      job.current?.abort();
                      setNotice("Export cancelled. You can start it again.");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="film-primary" disabled={!ready} onClick={generate}>
                {file ? "Generate again" : "Generate GIF"}
              </button>
            )}
            {error && (
              <div role="alert" className="film-error">
                {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
              </div>
            )}
          </div>
          {file && url && (
            <div className="film-result">
              <p>
                {size.width} × {size.height} · {seconds}s · {megabytes(file.size)}
              </p>
              <div className="film-actions">
                <a className="film-primary" href={url} download={file.name}>
                  <DownloadSimpleIcon size={16} /> Download GIF
                </a>
                {canShare && (
                  <button onClick={share}>
                    <ShareNetworkIcon size={16} /> Share…
                  </button>
                )}
              </div>
              <p className="small muted">
                {canShare
                  ? "Choose an app in the share sheet, or download to attach to a post."
                  : "Download and attach to your post. File sharing is unavailable in this browser."}
              </p>
            </div>
          )}
          <label className="film-caption">
            Suggested caption
            <textarea value={caption} readOnly rows={4} onFocus={(e) => e.target.select()} />
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
            <CopyIcon size={16} /> Copy caption
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
