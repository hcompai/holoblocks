import { DotsThreeIcon, GlobeIcon, LockSimpleIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { type ComponentProps, type FormEvent, useEffect, useState } from "react";
import { Confirm } from "./Confirm";
import { deleteAsk } from "./ShareMenu";
import { useMenu } from "./useMenu";

/** What the owner can do with one of their builds from its card. */
export interface ProjectActions {
  name: string;
  published: boolean;
  /** An imported build: making it private keeps it, since it has no session to fall back to. */
  imported: boolean;
  onRename: (name: string) => Promise<void>;
  onVisibility: (makePublic: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  /** What deleting does, when it is not the default. */
  deleteNote?: string;
}

type Ask = Omit<ComponentProps<typeof Confirm>, "onClose">;

/** A "…" on the owner's card: rename the build, publish it or make it private, or delete it, each confirmed. */
export function ProjectMenu(actions: ProjectActions) {
  const { name, published, imported, onRename, onVisibility, onDelete, deleteNote } = actions;
  const { open, setOpen, root } = useMenu();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setAsk(null);
    setRenaming(false);
    setError(null);
  }, [open]);

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    if (!next || next === name) return setOpen(false);
    setBusy(true);
    setError(null);
    try {
      await onRename(next);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const visibility: Ask = published
    ? {
        name: "Make private",
        question: `Make ${name} private?`,
        note: imported
          ? "It leaves the public library and stays under Your builds for you alone. You can publish it again."
          : "It leaves the public library and its link stops working. You can publish it again.",
        doing: "Making private…",
        icon: <LockSimpleIcon size={16} />,
        action: () => onVisibility(false),
      }
    : {
        name: "Publish",
        question: `Publish ${name}?`,
        note: imported
          ? "Everyone at H Company can open it from the library."
          : "Everyone at H Company can open it: Holo's latest model and the chat. Open the build to publish it with your hand edits.",
        doing: "Publishing…",
        icon: <GlobeIcon size={16} />,
        action: () => onVisibility(true),
      };

  return (
    <div className="menu-anchor project-menu" ref={root}>
      <button
        className={open ? "icon-button active" : "icon-button"}
        aria-label={`Rename, publish or delete ${name}`}
        title="Rename, publish or delete"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <DotsThreeIcon size={18} weight="bold" />
      </button>
      {open &&
        (ask ? (
          <Confirm {...ask} onClose={() => setOpen(false)} />
        ) : renaming ? (
          <form className="menu project-rename" aria-label="Rename" onSubmit={rename}>
            <input
              aria-label="New name"
              value={draft}
              maxLength={80}
              disabled={busy}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
            />
            {error && (
              <p className="publish-error" role="alert">
                {error}
              </p>
            )}
            <div className="publish-actions">
              <button type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy || !draft.trim()}>
                {busy ? "Renaming…" : "Rename"}
              </button>
            </div>
          </form>
        ) : (
          <div className="menu" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                setDraft(name);
                setRenaming(true);
              }}
            >
              <PencilSimpleIcon size={16} />
              Rename…
            </button>
            <button role="menuitem" onClick={() => setAsk(visibility)}>
              {published ? <LockSimpleIcon size={16} /> : <GlobeIcon size={16} />}
              {published ? "Make private…" : "Publish…"}
            </button>
            <hr />
            <button role="menuitem" className="danger" onClick={() => setAsk(deleteAsk(name, onDelete, deleteNote))}>
              <TrashIcon size={16} />
              Delete…
            </button>
          </div>
        ))}
    </div>
  );
}
