import { FilmStripIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import type { Build } from "./model";
import type { Publishing } from "./ShareMenu";
import { VisibilityToggle } from "./VisibilityToggle";

/** Over the model once Holo finishes: what to do with the build, starting with who can see it. */
export function FinishedCard({
  build,
  blocks,
  publishing,
  onGif,
  onClose,
}: {
  build: Build;
  /** How many blocks the model has, once counted. */
  blocks: number | null;
  publishing: Publishing;
  onGif: () => void;
  onClose: () => void;
}) {
  return (
    <section className="finished-card" aria-label="Build finished">
      <SparkleIcon className="finished-icon" size={20} weight="fill" aria-hidden="true" />
      <div className="finished-text">
        <b>{build.name} is ready</b>
        <span>
          {blocks !== null && `${blocks.toLocaleString()} blocks · `}
          {publishing.published ? "in the public library" : "only you can see it"}
        </span>
      </div>
      <div className="finished-actions">
        <VisibilityToggle publishing={publishing} name={build.name} />
        <button onClick={onGif} title="Share a GIF">
          <FilmStripIcon size={16} />
          <span className="button-label">GIF</span>
        </button>
      </div>
      <button className="quiet icon-button" aria-label="Dismiss" onClick={onClose}>
        <XIcon size={16} />
      </button>
    </section>
  );
}
