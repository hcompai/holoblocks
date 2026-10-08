import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "blockyard-theme";
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function stored(): Theme | null {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : null;
}

function current(): Theme {
  return stored() ?? (systemDark.matches ? "dark" : "light");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  systemDark.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    systemDark.removeEventListener("change", listener);
  };
}

/** Flip the theme and keep the choice; index.html applies it before the first paint. */
export function toggleTheme() {
  const next = current() === "dark" ? "light" : "dark";
  localStorage.setItem(KEY, next);
  document.documentElement.dataset.theme = next;
  for (const listener of listeners) listener();
}

/** The chosen theme, or the OS setting until the user picks one. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current);
}
