import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { Shelf } from "./library";
import type { BuildSummary } from "./model";
import { type ProjectActions, ProjectMenu } from "./ProjectMenu";

const PUBLIC_ROWS = 10;
const PLACEHOLDERS = 4;
const GAP = 16;
const TILE = 220;

interface Props {
  builds: BuildSummary[] | null;
  /** The shelves the last fetch could not load. */
  failed: Shelf[];
  /** The signed-in user's id, or null signed out: the public builds they own count as theirs too, such as imported ones. */
  me: string | null;
  onRetry: () => void;
  onOpen: (build: BuildSummary) => void;
  /** What sits beside the user's heading, such as the import button. */
  mineActions?: ReactNode;
  /** What the owner can do with one of their builds from its card, or null for nothing. */
  manage?: (build: BuildSummary, published: boolean) => ProjectActions | null;
}

function meta(b: BuildSummary, published = false): string {
  return [
    b.source === "showcase" ? "Showcase" : b.author ? `by ${b.author}` : null,
    published ? "public" : null,
    b.id.startsWith("import-") ? "imported" : null,
    b.private ? "private" : null,
    b.steps === null ? null : `${b.steps} step${b.steps === 1 ? "" : "s"}`,
    b.status === "building" ? "building…" : b.status === "error" ? "stopped" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The signed-in user's builds, running ones first, then newest: their sessions and forks, and their library builds with no session, such as imported ones. */
function mine(builds: BuildSummary[], me: string): BuildSummary[] {
  const sessions = builds.filter((b) => b.source === "session" || b.source === "fork");
  const ids = new Set(sessions.map((b) => b.id));
  const owned = builds.filter((b) => b.source === "public" && b.owner === me && !ids.has(b.id));
  return [...sessions, ...owned].sort(
    (a, b) => Number(b.status === "building") - Number(a.status === "building") || b.created - a.created,
  );
}

interface TileProps {
  build: BuildSummary;
  published: boolean;
  onOpen: () => void;
}

/** A build as a card, with the owner's menu in its corner when they can manage it. */
function Tile({ actions, ...card }: TileProps & { actions?: ProjectActions | null }) {
  if (!actions) return <Card {...card} />;
  return (
    <div className="tile-owned">
      <Card {...card} />
      <ProjectMenu {...actions} />
    </div>
  );
}

/** A build as a card: its thumbnail, name and what to know about it. */
function Card({ build: b, published, onOpen }: TileProps) {
  return (
    <button className="gallery-card" title={b.prompt} onClick={onOpen}>
      {b.thumbnail != null ? (
        <img src={b.thumbnail} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="gallery-thumb">{b.name.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="gallery-caption">
        <b>{b.name}</b>
        <span className="muted small">{meta(b, published)}</span>
      </div>
    </button>
  );
}

/** How many tiles fit across the shelves. */
function useColumns() {
  const root = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setColumns(Math.max(1, Math.floor((entry.contentRect.width + GAP) / (TILE + GAP)))),
    );
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  return [root, columns] as const;
}

/** Under the home composer: one row of the user's builds, then the public builds with the showcases, ten rows at a time. */
export function HomeShelves({ builds, failed, me, onRetry, onOpen, mineActions, manage }: Props) {
  const [root, columns] = useColumns();
  const [allMine, setAllMine] = useState(false);
  const [publicRows, setPublicRows] = useState(PUBLIC_ROWS);
  // Private builds are their owner's alone: under the user's builds, never under Public.
  const everyone = builds?.filter((b) => b.source !== "session" && b.source !== "fork" && !b.private) ?? [];
  const published = new Set(everyone.filter((b) => b.source === "public").map((b) => b.id));
  const yours = me ? mine(builds ?? [], me) : [];
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  const section = (
    title: string,
    shelf: Shelf,
    all: BuildSummary[],
    shown: BuildSummary[],
    empty: string,
    actions?: ReactNode,
    more?: ReactNode,
    owned = false,
  ) => (
    <section className="home-shelf" aria-label={title}>
      <h2>
        {title}
        {builds && <span className="count">{all.length}</span>}
        <span className="spacer" />
        {actions}
      </h2>
      {failed.includes(shelf) && (
        <div className="load-failed" role="alert">
          <span>{all.length ? "Couldn't refresh these builds." : "Couldn't load these builds."}</span>
          <button onClick={onRetry}>Retry</button>
        </div>
      )}
      {builds === null ? (
        <div className="gallery-grid" style={grid} aria-busy="true">
          {Array.from({ length: Math.min(PLACEHOLDERS, columns) }, (_, i) => (
            <div key={i} className="skeleton">
              <div className="gallery-thumb" />
              <div className="gallery-caption">
                <div className="bar wide" />
                <div className="bar" />
              </div>
            </div>
          ))}
        </div>
      ) : !all.length ? (
        !failed.includes(shelf) && <p className="home-empty">{empty}</p>
      ) : (
        <div className="gallery-grid" style={grid}>
          {shown.map((b) => {
            const listed = (b.source === "session" || b.source === "fork") && published.has(b.id);
            return (
              <Tile
                key={`${b.source}:${b.id}`}
                build={b}
                published={listed}
                onOpen={() => onOpen(b)}
                actions={owned ? manage?.(b, listed || (b.source === "public" && !b.private)) : null}
              />
            );
          })}
        </div>
      )}
      {more}
    </section>
  );

  const publicShown = everyone.slice(0, columns * publicRows);
  return (
    <div className="home-shelves" ref={root}>
      {me &&
        section(
          "Your builds",
          "mine",
          yours,
          allMine ? yours : yours.slice(0, columns),
          "Your builds will show up here once you describe one above or import a model.",
          <>
            {yours.length > columns && (
              <button className="quiet" onClick={() => setAllMine(!allMine)}>
                {allMine ? "Show less" : "Show all"}
              </button>
            )}
            {mineActions}
          </>,
          undefined,
          true,
        )}
      {section(
        "Public builds",
        "public",
        everyone,
        publicShown,
        "Builds people publish will show up here, and yours can be the first.",
        undefined,
        publicShown.length < everyone.length && (
          <button className="home-more" onClick={() => setPublicRows(publicRows + PUBLIC_ROWS)}>
            Show more builds
          </button>
        ),
      )}
    </div>
  );
}
