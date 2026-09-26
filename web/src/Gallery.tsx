import { api, GALLERY, type BuildSummary } from "./api";

interface Props {
  builds: BuildSummary[];
  onOpen: (id: string) => void;
}

export function Gallery({ builds, onOpen }: Props) {
  return (
    <div className="gallery">
      <h2>Library</h2>
      <p className="muted">
        {GALLERY
          ? "Open a build to replay it step by step."
          : "Open a build to replay it step by step, or describe a new one in the chat."}
      </p>
      {builds.length ? (
        <div className="gallery-grid">
          {builds.map((b) => (
            <button key={b.id} className="gallery-card" onClick={() => onOpen(b.id)}>
              {b.thumbnail ? (
                <img src={api.thumbnailUrl(b.id)} alt="" />
              ) : (
                <div className="gallery-thumb">{b.name.slice(0, 1).toUpperCase()}</div>
              )}
              <div className="gallery-caption">
                <b>{b.name}</b>
                <span className="muted small">
                  {b.steps} steps{b.status === "building" ? " · building…" : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">No builds yet. Describe one in the chat.</div>
      )}
    </div>
  );
}
