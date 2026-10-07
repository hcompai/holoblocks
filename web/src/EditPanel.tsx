import {
  ArrowDownIcon,
  ArrowDownLeftIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  CaretDownIcon,
  CopyIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BlockSwatch } from "./BlocksPanel";
import type { Edits } from "./edits";
import { PALETTE, textureSheet, type TextureSheet } from "./model";

/** What the selected blocks can do; moves follow the screen, snapped to the build's axes. */
export type Action = "left" | "right" | "forward" | "back" | "up" | "down" | "duplicate" | "delete";

/** Keys for each action in edit mode, as `KeyboardEvent.key`: arrows move across the screen, W/S into it. */
export const ACTION_KEYS: Record<string, Action> = {
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
  ArrowUp: "up",
  e: "up",
  PageUp: "up",
  ArrowDown: "down",
  q: "down",
  PageDown: "down",
  w: "forward",
  s: "back",
  Delete: "delete",
  Backspace: "delete",
};

const MOVES: { action: Action; label: string; icon: ReactNode }[] = [
  { action: "up", label: "Move up (↑, E)", icon: <ArrowUpIcon size={16} weight="bold" /> },
  { action: "forward", label: "Move away (W)", icon: <ArrowUpRightIcon size={16} weight="bold" /> },
  { action: "left", label: "Move left (←, A)", icon: <ArrowLeftIcon size={16} weight="bold" /> },
  { action: "down", label: "Move down (↓, Q)", icon: <ArrowDownIcon size={16} weight="bold" /> },
  { action: "right", label: "Move right (→, D)", icon: <ArrowRightIcon size={16} weight="bold" /> },
  { action: "back", label: "Move closer (S)", icon: <ArrowDownLeftIcon size={16} weight="bold" /> },
];

const ALL_BLOCKS = Object.keys(PALETTE).sort();

export const blockLabel = (block: string) => block.replaceAll("_", " ");

function useSheet(): TextureSheet | null {
  const [sheet, setSheet] = useState<TextureSheet | null>(null);
  useEffect(() => void textureSheet().then(setSheet, console.error), []);
  return sheet;
}

interface PickerProps {
  /** The block right-click places, and picking one puts in the selection. */
  hand: string;
  /** The build's blocks, most used first. */
  used: string[];
  /** How many blocks picking replaces. */
  selected: number;
  onPick: (block: string) => void;
}

/** The block in hand, and a picker listing the build's own blocks before every other, searchable. */
function BlockPicker({ hand, used, selected, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const sheet = useSheet();
  const wanted = query.trim().toLowerCase().replaceAll(" ", "_");
  const sections = [
    { label: "In this build", blocks: used.filter((b) => b.includes(wanted)) },
    { label: "All blocks", blocks: ALL_BLOCKS.filter((b) => b.includes(wanted)) },
  ].filter((s) => s.blocks.length);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const pick = (block: string) => {
    onPick(block);
    setOpen(false);
    setQuery("");
  };
  const placeholder = selected
    ? `Replace ${selected === 1 ? "the block" : `the ${selected} blocks`} with…`
    : "Search blocks";
  return (
    <div className="block-picker" ref={root}>
      <button
        className="block-hand"
        aria-expanded={open}
        aria-label={`Block in hand: ${blockLabel(hand)}`}
        title={selected ? "Replace the selection" : "The block right-click places"}
        onClick={() => setOpen(!open)}
      >
        {sheet && <BlockSwatch sheet={sheet} info={PALETTE[hand]} />}
        <span>{blockLabel(hand)}</span>
        <CaretDownIcon size={12} weight="bold" />
      </button>
      {open && (
        <div className="block-list">
          <input
            autoFocus
            type="search"
            placeholder={placeholder}
            aria-label="Search blocks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          />
          <div role="listbox" aria-label="Blocks">
            {sections.map((section) => (
              <section key={section.label}>
                <small>{section.label}</small>
                {section.blocks.map((block) => (
                  <button key={block} role="option" aria-selected={block === hand} onClick={() => pick(block)}>
                    {sheet && <BlockSwatch sheet={sheet} info={PALETTE[block]} />}
                    {blockLabel(block)}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const HINT = matchMedia("(any-pointer: fine)").matches
  ? "Click a block to select it; right-click a face to place the block in hand"
  : "Tap a block to select it";

/** The edit toolbar: how many changes, the block in hand, undo, redo and reset. */
export function EditBar({ edits, ...picker }: { edits: Edits } & PickerProps) {
  const count = edits.edits.length;
  return (
    <div className="edit-bar" role="toolbar" aria-label="Edit mode">
      <span>{count ? `${count} change${count === 1 ? "" : "s"}` : HINT}</span>
      <BlockPicker {...picker} />
      <button className="icon-button" onClick={edits.undo} disabled={!count} title="Undo (⌘Z)" aria-label="Undo">
        <ArrowUUpLeftIcon size={16} weight="bold" />
      </button>
      <button
        className="icon-button"
        onClick={edits.redo}
        disabled={!edits.canRedo}
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
      >
        <ArrowUUpRightIcon size={16} weight="bold" />
      </button>
      <button onClick={edits.reset} disabled={!count}>
        Reset
      </button>
    </div>
  );
}

/** The selection's controls: move it a block, duplicate or delete it. */
export function EditPanel({
  label,
  onAction,
  onClose,
}: {
  label: string;
  onAction: (a: Action) => void;
  onClose: () => void;
}) {
  return (
    <div className="edit-panel" role="dialog" aria-label="Selection">
      <div className="edit-panel-head">
        <b title={label}>{label}</b>
        <button className="icon-button" onClick={onClose} title="Deselect (Esc)" aria-label="Deselect">
          <XIcon size={14} weight="bold" />
        </button>
      </div>
      <div className="edit-moves">
        {MOVES.map((m) => (
          <button
            key={m.action}
            style={{ gridArea: m.action }}
            onClick={() => onAction(m.action)}
            title={m.label}
            aria-label={m.label}
          >
            {m.icon}
          </button>
        ))}
      </div>
      <div className="edit-actions">
        <button onClick={() => onAction("duplicate")} title="Duplicate beside it (⌘D)" aria-label="Duplicate">
          <CopyIcon size={16} weight="bold" />
        </button>
        <button className="danger" onClick={() => onAction("delete")} title="Delete (Del)" aria-label="Delete">
          <TrashIcon size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}
