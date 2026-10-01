import { useState } from "react";
import { card } from "./library";
import type { Build } from "./model";
import { canRestore, RecoveryProblem, recover } from "./recovery";

/** How to carry on with a build whose session failed: a new session continues it. */
export function RecoveryPanel({
  build,
  edited,
  onOpen,
}: {
  /** Holo's last shared version. */
  build: Build;
  edited: boolean;
  onOpen: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = canRestore(build);
  const previous = card(build.id)?.recoveryAttempt;
  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onOpen(await recover(build));
    } catch (e) {
      console.error(e);
      setError(
        e instanceof RecoveryProblem
          ? e.message
          : "No new session could be confirmed. Your build is unchanged: check the library for it before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="recovery-panel" aria-label="Build recovery">
      <strong>Building was interrupted</strong>
      <p>
        {restore
          ? "Continue from the last shared version in a new session, with your requests and photos. This build stays as it is."
          : "Try again with your original requests and photos in a new session."}
      </p>
      {restore && edited && <p>Your hand edits stay here: the new session starts from Holo's version.</p>}
      <button disabled={busy} onClick={start}>
        {busy
          ? "Preparing your build…"
          : previous
            ? "Open recovery attempt"
            : restore
              ? "Continue from saved version"
              : "Try again with same request"}
      </button>
      {error && <p role="alert">{error}</p>}
      {build.failure && (
        <details>
          <summary>Technical details</summary>
          <p className="failure-detail">{build.failure}</p>
        </details>
      )}
    </section>
  );
}
