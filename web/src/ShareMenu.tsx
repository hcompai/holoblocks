import {
  CheckIcon,
  CubeIcon,
  ExportIcon,
  FilmStripIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LockSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { type ComponentProps, useEffect, useState } from "react";
import { Confirm } from "./Confirm";
import type { Build } from "./model";
import { schematic } from "./schematic";
import { useMenu } from "./useMenu";
import { usePhone } from "./usePhone";
import { ImageShare } from "./ImageShare";

const COPIED_MS = 2000;

/** The owner's side of sharing: whether the build is in the public library, and how to change it. */
export interface Publishing {
  published: boolean;
  /** An imported build: making it private keeps it under the user's builds, since it has no session to fall back to. */
  imported: boolean;
  /** Why the build cannot be published yet, or null when it can. */
  blocked: string | null;
  author: string;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
}

interface Props {
  build: Build;
  /** The link anyone can open, or null while the build is private. */
  link: string | null;
  /** Null when the build is not the signed-in user's. */
  publishing: Publishing | null;
  /** Deletes the build for good, or null when it cannot be deleted. */
  onDelete: (() => Promise<void>) | null;
  /** What deleting does, when it is not the default. */
  deleteNote?: string;
  image: () => Promise<Blob | null>;
  onGif: () => void;
}

type Ask = Omit<ComponentProps<typeof Confirm>, "onClose">;

function publishAsk({ published, imported, author, onPublish, onUnpublish }: Publishing): Ask {
  return published
    ? {
        name: "Make private",
        question: "Make this build private?",
        note: imported
          ? "It leaves the public library and stays under Your builds for you alone: its link only opens it for you. You can publish it again."
          : "It leaves the public library and its link stops working. You can publish it again.",
        doing: "Making private…",
        icon: <LockSimpleIcon size={16} />,
        action: onUnpublish,
      }
    : {
        name: "Publish",
        question: "Publish this build?",
        note: imported
          ? `Anyone can open it from the library, as ${author}'s.`
          : `Anyone can open it, as ${author}'s: the model, the chat, and the photos you attached.`,
        doing: "Publishing…",
        icon: <GlobeIcon size={16} />,
        action: onPublish,
      };
}

const DELETE_NOTE = "It leaves your builds and the public library. This cannot be undone.";
/** The platform keeps every session, so deleting one hides it. */
export const SESSION_DELETE_NOTE =
  "It leaves your builds and the public library. Its chat stays on H's platform, and its link still opens it. This cannot be undone.";

export const deleteAsk = (name: string, action: () => Promise<void>, note = DELETE_NOTE): Ask => ({
  name: "Delete",
  question: `Delete ${name}?`,
  note,
  doing: "Deleting…",
  icon: <TrashIcon size={16} />,
  danger: true,
  action,
});

/** Every way to take the build elsewhere: who can open it, its link, a GIF, the schematic or an image. */
export function ShareMenu({ build, link, publishing, onDelete, deleteNote, image, onGif }: Props) {
  const phone = usePhone();
  const { open, setOpen, root } = useMenu();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [copied, setCopied] = useState(false);
  const [capture, setCapture] = useState<{ name: string; building: boolean; image: Promise<Blob | null> } | null>(null);
  const built = build.boxes.length > 0;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!open) setAsk(null);
  }, [open]);

  const copy = () => link && navigator.clipboard.writeText(link).then(() => setCopied(true), console.error);

  const save = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: `${build.name}.${extension}` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const then = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="menu-anchor" ref={root}>
      <button
        className={open ? "share-button active" : "share-button"}
        onClick={() => setOpen(!open)}
        disabled={!built && !link && !publishing}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ExportIcon size={16} />
        <span className="button-label">Share</span>
      </button>
      {open &&
        (ask ? (
          <Confirm {...ask} onClose={() => setOpen(false)} />
        ) : (
          <div className="menu" role="menu">
            {phone && (
              <>
                <button role="menuitem" disabled={!built} onClick={then(onGif)}>
                  <FilmStripIcon size={18} />
                  GIF
                </button>
                <button
                  role="menuitem"
                  disabled={!built}
                  onClick={then(() =>
                    setCapture({ name: build.name, building: build.status === "building", image: image() }),
                  )}
                >
                  <ImageIcon size={18} />
                  Image
                </button>
                <hr />
              </>
            )}
            {publishing && (
              <>
                <p className="menu-state">
                  {publishing.published ? <GlobeIcon size={16} /> : <LockSimpleIcon size={16} />}
                  {publishing.published
                    ? "In the public library: anyone can open it"
                    : "Private: not in the public library"}
                </p>
                <button
                  role="menuitem"
                  disabled={!publishing.published && publishing.blocked !== null}
                  onClick={() => setAsk(publishAsk(publishing))}
                >
                  {publishing.published ? <LockSimpleIcon size={16} /> : <GlobeIcon size={16} />}
                  {publishing.published ? "Make private…" : (publishing.blocked ?? "Publish to the library…")}
                </button>
              </>
            )}
            {(link || publishing) && (
              <>
                <button role="menuitem" disabled={!link} onClick={copy}>
                  {copied ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
                  {copied ? "Link copied" : "Copy link"}
                </button>
                <hr />
              </>
            )}
            {!phone && (
              <>
                <button role="menuitem" disabled={!built} onClick={then(onGif)}>
                  <FilmStripIcon size={16} />
                  Share a GIF…
                </button>
                <hr />
              </>
            )}
            <button
              role="menuitem"
              disabled={!built}
              onClick={then(() => void schematic(build).then((schem) => save(schem, "schem")))}
            >
              <CubeIcon size={16} />
              Download .schem
            </button>
            {!phone && (
              <button
                role="menuitem"
                disabled={!built}
                onClick={then(() => void image().then((png) => png && save(png, "png")))}
              >
                <ImageIcon size={16} />
                Download image
              </button>
            )}
            {onDelete && (
              <>
                <hr />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => setAsk(deleteAsk(build.name, onDelete, deleteNote))}
                >
                  <TrashIcon size={16} />
                  Delete…
                </button>
              </>
            )}
          </div>
        ))}
      {capture && (
        <ImageShare
          name={capture.name}
          building={capture.building}
          capture={capture.image}
          onClose={() => setCapture(null)}
        />
      )}
    </div>
  );
}
