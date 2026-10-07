import { XIcon } from "@phosphor-icons/react";
import type { Version } from "./history";

interface Props {
  versions: Version[];
  /** The previewed version's id, or null for Latest. */
  selected: string | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onSelect: (version: Version | null) => void;
  onClose: () => void;
}

/** The models Holo shared, newest first: picking one previews it, picking Latest goes back. */
export function HistoryPanel({ versions, selected, loading, error, onRetry, onSelect, onClose }: Props) {
  return (
    <section className="history-panel" aria-label="Version history">
      <div className="history-heading">
        <strong>History</strong>
        <span className="muted small">Saved models</span>
        <span className="spacer" />
        {loading && (
          <span role="status" className="muted small">
            Loading…
          </span>
        )}
        <button className="icon-button" aria-label="Close history" title="Close history" onClick={onClose}>
          <XIcon size={14} />
        </button>
      </div>
      {error ? (
        <div className="history-error" role="alert">
          History unavailable <button onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <div className="history-versions">
          {[...versions].reverse().map((version, index) => {
            const latest = index === 0 && !loading;
            const active = selected === version.id || (!selected && latest);
            const steps = version.model.steps.length;
            return (
              <button
                key={version.id}
                className={active ? "active" : ""}
                aria-label={`V${version.number}${latest ? " · Latest" : ""}`}
                aria-pressed={active}
                onClick={() => onSelect(latest ? null : version)}
              >
                <strong>
                  V{version.number} {latest && <span className="muted small">Latest</span>}
                </strong>
                <span>
                  {steps} step{steps === 1 ? "" : "s"}
                </span>
                <span className="muted small">
                  {version.at
                    ? new Date(version.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "Starting model"}
                </span>
              </button>
            );
          })}
          {!versions.length && !loading && <span className="muted">No saved models yet</span>}
        </div>
      )}
    </section>
  );
}
