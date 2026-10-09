import { CheckIcon, MoonIcon } from "@phosphor-icons/react";
import { toggleTheme, useTheme } from "./theme";

/** A menu item turning the dark theme on or off; the OS setting applies until it is clicked. */
export function ThemeToggle() {
  const dark = useTheme() === "dark";
  return (
    <button role="menuitemcheckbox" aria-checked={dark} onClick={toggleTheme}>
      <MoonIcon size={16} />
      Dark theme
      {dark && <CheckIcon size={16} className="menu-check" />}
    </button>
  );
}
