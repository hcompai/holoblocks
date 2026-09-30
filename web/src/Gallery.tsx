import type { BuildSummary } from "./model";
import { LoadFailed, PLACEHOLDERS } from "./LibraryPanel";

interface Props {
  /** Why no build can start here, or null when one can. */
  closed: string | null;
  builds: BuildSummary[] | null;
  failed: boolean;
  onRetry: () => void;
  onOpen: (id: string) => void;
}

export function Gallery({ closed, builds, failed, onRetry, onOpen }: Props) {
  return (
    <div className="gallery">
      <h2>Library</h2>
      <p className="muted">
        {closed
          ? "Open a build to replay it step by step."
          : "Open a build to replay it step by step, or describe a new one in the chat."}
      </p>
      {builds === null && failed ? (
        <LoadFailed onRetry={onRetry} />
      ) : builds === null ? (
        <div className="gallery-grid">
          {Array.from({ length: PLACEHOLDERS }, (_, i) => (
            <div key={i} className="gallery-card skeleton">
              <div className="gallery-thumb" />
              <div className="gallery-caption">
                <div className="bar wide" />
                <div className="bar" />
              </div>
            </div>
          ))}
        </div>
      ) : builds.length ? (
        <div className="gallery-grid">
          {builds.map((b) => (
            <button key={b.id} className="gallery-card" onClick={() => onOpen(b.id)}>
              {b.thumbnail != null ? (
                <img src={b.thumbnail} alt="" loading="lazy" decoding="async" />
              ) : (
                <div className="gallery-thumb">{b.name.slice(0, 1).toUpperCase()}</div>
              )}
              <div className="gallery-caption">
                <b>{b.name}</b>
                <span className="muted small">
                  {[b.steps !== null && `${b.steps} steps`, b.status === "building" && "building…"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">{closed ?? "No builds yet. Describe one in the chat."}</div>
      )}
    </div>
  );
}
