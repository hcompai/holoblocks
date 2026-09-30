import { CubeIcon, DownloadSimpleIcon, ImageIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

interface Props {
  onSchem: () => void;
  onImage: () => void;
}

export function DownloadMenu({ onSchem, onImage }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    items()[0]?.focus();
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        const next = at < 0 ? 0 : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", keydown);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={root}>
      <button
        ref={trigger}
        className={`icon-button ${open ? "active" : ""}`}
        title="Download"
        aria-label="Download"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <DownloadSimpleIcon size={16} weight="bold" />
      </button>
      {open && (
        <div className="menu" role="menu" ref={menu}>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSchem();
            }}
          >
            <CubeIcon size={16} />
            Download .schem
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onImage();
            }}
          >
            <ImageIcon size={16} />
            Download image
          </button>
        </div>
      )}
    </div>
  );
}
