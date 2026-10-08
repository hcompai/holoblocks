import { IdentificationCardIcon, SignOutIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useState } from "react";
import { type Account, setName, signOut } from "./account";
import { displayName, saveDisplayName } from "./library";
import { useMenu } from "./useMenu";

const MAX_NAME = 32;

/** The signed-in user, with a menu to set the name on their public builds or sign out. */
export function AccountMenu({
  account,
  building,
  onRenamed,
}: {
  account: Account;
  building: boolean;
  /** The user's builds now carry their new name. */
  onRenamed: () => void;
}) {
  const { open, setOpen, root } = useMenu();
  const { name, email } = account.user;
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setNaming(false);
    setError(null);
  }, [open]);

  const startNaming = () => {
    setDraft(name);
    setNaming(true);
    displayName().then(
      (current) => {
        setName(current);
        setDraft((typed) => (typed === name ? current : typed));
      },
      () => {},
    );
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setName(await saveDisplayName(draft));
      setOpen(false);
      onRenamed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu-anchor" ref={root}>
      <button
        className={open ? "icon-button avatar active" : "icon-button avatar"}
        onClick={() => setOpen(!open)}
        title={email}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {(name || email).slice(0, 1).toUpperCase()}
      </button>
      {open &&
        (naming ? (
          <form className="menu project-rename" aria-label="Display name" onSubmit={save}>
            <input
              aria-label="Display name"
              value={draft}
              maxLength={MAX_NAME}
              disabled={busy}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className="muted small">Shown on your public builds.</p>
            {error && (
              <p className="publish-error" role="alert">
                {error}
              </p>
            )}
            <div className="publish-actions">
              <button type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <div className="menu" role="menu">
            <div className="menu-head">
              {name && <b>{name}</b>}
              <span className="muted small">{email}</span>
            </div>
            <button role="menuitem" onClick={startNaming}>
              <IdentificationCardIcon size={16} /> Display name
              <span className="menu-value muted small">{name || "None"}</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                if (building && !window.confirm("Holo still needs this tab to render your build. Sign out anyway?"))
                  return;
                setOpen(false);
                signOut();
              }}
            >
              <SignOutIcon size={16} /> Sign out
            </button>
          </div>
        ))}
    </div>
  );
}
