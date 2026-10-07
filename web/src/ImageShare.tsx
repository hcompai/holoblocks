import { DownloadSimpleIcon, ExportIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

/** Prepare before the Share tap, so the native sheet keeps its user activation. */
export function ImageShare({
  name,
  building,
  capture,
  onClose,
}: {
  name: string;
  building: boolean;
  capture: Promise<Blob | null>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState<{ file: File; url: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    capture.then(
      (blob) => {
        if (!active) return;
        if (!blob) {
          setError("Image unavailable. Close and try again.");
          return;
        }
        url = URL.createObjectURL(blob);
        setReady({ file: new File([blob], `${name}.png`, { type: "image/png" }), url });
      },
      () => {
        if (active) setError("Image unavailable. Close and try again.");
      },
    );
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [capture, name]);
  const canShare = !!ready && !!navigator.share && !!navigator.canShare?.({ files: [ready.file] });
  const share = async () => {
    if (!ready) return;
    setError("");
    try {
      await navigator.share({ files: [ready.file], title: name });
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) setError("Sharing unavailable. Save the image instead.");
    }
  };
  return (
    <dialog className="film-dialog image-share" ref={dialog} aria-label="Share image" onCancel={onClose}>
      <div className="film-heading">
        <h2>Share image</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={20} />
        </button>
      </div>
      {building && <p className="muted small">Build so far</p>}
      {ready ? (
        <>
          <img src={ready.url} alt={name} />
          <div className="film-actions">
            {canShare && (
              <button className="film-primary" onClick={share}>
                <ExportIcon size={18} />
                Share…
              </button>
            )}
            <a className={canShare ? "film-secondary" : "film-primary"} href={ready.url} download={ready.file.name}>
              <DownloadSimpleIcon size={18} />
              Save image
            </a>
          </div>
        </>
      ) : (
        !error && <p role="status">Preparing image…</p>
      )}
      {error && (
        <p role="alert" className="film-error">
          {error}
        </p>
      )}
    </dialog>
  );
}
