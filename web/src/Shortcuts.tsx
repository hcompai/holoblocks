import { QuestionIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { typing } from "./scene";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";

/** Every mouse and keyboard control, by mode: [keys, what they do]. */
const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "View",
    rows: [
      ["Drag", "Turn around the build"],
      ["Right-drag", "Pan"],
      ["Scroll", "Zoom"],
      ["?", "Show or hide these shortcuts"],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Click", "Select a block"],
      [`Shift-click, ${MOD}click`, "Add or remove a block"],
      ["Shift-drag", "Add the blocks seen in a box"],
      ["Right-click", "Place the block in hand on a face"],
      ["← → ↑ ↓", "Move a block, as seen on screen"],
      ["E, Page Up / Q, Page Down", "Move up / down a block"],
      [`${MOD}D`, "Duplicate beside it"],
      ["Delete, Backspace", "Delete"],
      [`${MOD}Z / Shift-${MOD}Z`, "Undo / redo"],
      ["Esc", "Clear the selection"],
    ],
  },
  {
    title: "Walk",
    rows: [
      ["Click", "Take the mouse to look around"],
      ["W A S D, arrows", "Walk"],
      ["W W", "Sprint: tap twice, then hold"],
      ["Space", "Jump"],
      ["Space Space", "Fly, or drop to the ground"],
      ["Space / Shift", "Fly up / down"],
      ["Esc", "Release the mouse; again to stop walking"],
    ],
  },
];

/** A "?" button beside the view controls opening every shortcut; the ? key toggles it too. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === "?") setOpen((o) => !o);
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div className="menu-anchor" ref={root}>
      <button
        className={open ? "active" : ""}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Shortcuts"
        title="Shortcuts (?)"
      >
        <QuestionIcon size={14} weight="bold" />
      </button>
      {open && (
        <div className="shortcuts" role="dialog" aria-label="Shortcuts">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <b>{section.title}</b>
              <dl>
                {section.rows.map(([keys, action]) => (
                  <div key={keys}>
                    <dt>{keys}</dt>
                    <dd>{action}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
