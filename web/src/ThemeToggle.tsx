import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { toggleTheme, useTheme } from "./theme";

export function ThemeToggle() {
  const theme = useTheme();
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button className="icon-button" onClick={toggleTheme} title={label} aria-label={label}>
      {theme === "dark" ? <SunIcon size={16} weight="bold" /> : <MoonIcon size={16} weight="bold" />}
    </button>
  );
}
