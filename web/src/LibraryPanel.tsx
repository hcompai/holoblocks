import { api, type BuildSummary } from "./api";

interface Props {
  builds: BuildSummary[] | null;
  /** Whether the last fetch of the library failed. */
  failed: boolean;
  onRetry: () => void;
  activeId: string | null;
  onOpen: (id: string) => void;
}

export const PLACEHOLDERS = 6;

export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="load-failed" role="alert">
      <span>Couldn't load the library.</span>
      <button onClick={onRetry}>Retry</button>
    </div>
  );
}

export function LibraryPanel({ builds, failed, onRetry, activeId, onOpen }: Props) {
  if (builds === null && failed) return <LoadFailed onRetry={onRetry} />;
  if (builds === null)
    return (
      <div className="library">
        {Array.from({ length: PLACEHOLDERS }, (_, i) => (
          <div key={i} className="card skeleton">
            <div className="thumb" />
            <div className="card-body">
              <div className="bar wide" />
              <div className="bar wide" />
              <div className="bar" />
            </div>
          </div>
        ))}
      </div>
    );
  if (!builds.length) return <div className="empty">No builds yet. Start one from the chat.</div>;
  return (
    <div className="library">
      {builds.map((b) => (
        <button key={b.id} className={`card ${b.id === activeId ? "active" : ""}`} onClick={() => onOpen(b.id)}>
          {b.thumbnail != null ? (
            <img className="thumb" src={api.thumbnailUrl(b.id, b.thumbnail)} alt="" loading="lazy" decoding="async" />
          ) : (
            <div className="thumb">{b.name.slice(0, 1).toUpperCase()}</div>
          )}
          <div className="card-body">
            <b>{b.name}</b>
            <span className="muted">{b.prompt}</span>
            <span className="muted small">
              {b.steps} steps{b.status === "building" ? " · building…" : ""}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
