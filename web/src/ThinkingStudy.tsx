import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { BlockSwatch } from "./BlocksPanel";
import { PALETTE, textureSheet, type TextureSheet } from "./model";
import type { Reference } from "./session";
import type { BuildSubject } from "./buildSubject";

/** A contact sheet of photos actually supplied by the user or opened by Holo. */
export function ReferenceBoard({
  references,
  compact = false,
  fallback = null,
}: {
  references: Reference[];
  compact?: boolean;
  fallback?: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const visible = references.filter((reference) => !failed.includes(reference.src));
  const latest = visible.at(-1);
  useEffect(() => setSelected(latest?.id ?? null), [latest?.id]);
  const current = visible.find((reference) => reference.id === selected) ?? latest;
  if (!current) return fallback;
  return (
    <div className={`thinking-references ${compact ? "thinking-references-compact" : ""}`}>
      {(!compact || expanded) && (
        <figure className="thinking-reference" key={current.src}>
          <div className="thinking-reference-image">
            <img
              src={current.src}
              alt={current.caption}
              referrerPolicy="no-referrer"
              onError={() => setFailed((old) => [...old, current.src])}
            />
            <span className="thinking-photo-corners" aria-hidden="true" />
          </div>
          <figcaption>
            {current.kind === "showcase" && <span>Showcase</span>}
            <strong>{current.caption}</strong>
          </figcaption>
        </figure>
      )}
      <div className="thinking-contact-sheet" aria-label="Reference photos">
        {visible.map((reference, index) => (
          <button
            key={reference.id}
            className="thinking-reference-thumb"
            style={{ "--order": index } as CSSProperties}
            aria-label={`View ${reference.caption}`}
            aria-pressed={reference.id === current.id}
            aria-expanded={compact ? expanded && reference.id === current.id : undefined}
            onClick={() => {
              setSelected(reference.id);
              if (compact) setExpanded(!expanded || reference.id !== current.id);
            }}
          >
            <img
              src={reference.src}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setFailed((old) => [...old, reference.src])}
            />
            <span>{String(index + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function suggestions(subject: BuildSubject, request: string): string[] {
  const text = request.toLowerCase();
  if (subject.kind === "tree" || /forest|garden|grove/.test(text))
    return ["stone_bricks", "mossy_cobblestone", "oak_log", "oak_leaves", "grass_block", "lantern"];
  if (/wood|timber|cabin/.test(text) || subject.kind === "ship")
    return ["oak_planks", "dark_oak_log", "spruce_planks", "white_wool", "glass", "lantern"];
  if (subject.kind === "animal")
    return ["white_wool", "brown_wool", "black_wool", "orange_terracotta", "green_concrete", "stone"];
  return ["stone_bricks", "cobblestone", "mossy_stone_bricks", "oak_planks", "glass", "lantern"];
}

/** Explore real palette textures; Holo’s search results replace the initial examples. */
export function MaterialStudy({
  subject,
  request,
  materials = [],
}: {
  subject: BuildSubject;
  request: string;
  materials?: string[];
}) {
  const [sheet, setSheet] = useState<TextureSheet | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    textureSheet().then(
      (value) => {
        if (active) setSheet(value);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  const found = materials.filter((name) => name in PALETTE).slice(0, 6);
  const names = found.length ? found : suggestions(subject, request);
  const current = selected && names.includes(selected) ? selected : names[0];
  return (
    <div className="thinking-material-study">
      <div className="thinking-materials">
        {names.map((name, index) => (
          <button
            key={name}
            className="thinking-material"
            style={{ "--order": index } as CSSProperties}
            aria-pressed={name === current}
            onClick={() => setSelected(name)}
            title={PALETTE[name]?.shape ?? "cube"}
          >
            <span className="thinking-material-texture" aria-hidden="true">
              {sheet && <BlockSwatch sheet={sheet} info={PALETTE[name]} size={44} />}
            </span>
            <span>{name.replaceAll("_", " ")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NameStudy({ title }: { title?: string | null }) {
  return (
    <div className="thinking-name-study" key={title}>
      <div className="thinking-name-title" aria-label={title ?? "A name is on its way"}>
        {title ? (
          title.split("").map((letter, index) => (
            <span key={index} aria-hidden="true" style={{ "--order": index } as CSSProperties}>
              {letter}
            </span>
          ))
        ) : (
          <span className="thinking-name-pending" aria-hidden="true">
            ···
          </span>
        )}
      </div>
      <svg viewBox="0 0 240 20" fill="none" aria-hidden="true">
        <path className="thinking-name-line" d="M12 13Q92 3 227 10M33 17Q98 8 202 15" />
      </svg>
    </div>
  );
}
