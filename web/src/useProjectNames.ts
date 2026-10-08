import { useEffect, useRef, useState } from "react";
import { type ProjectName, projectNames, renameProject } from "./library";

type Names = Record<string, ProjectName>;

/** The names the user gave their builds; a rename is kept here while the Blob CDN still serves the old one. None signed out. */
export function useProjectNames(owner: string | null) {
  const storage = `blockyard.names.${owner}`;
  const [names, setNames] = useState<Names>(() => {
    if (!owner) return {};
    try {
      const saved = JSON.parse(localStorage.getItem(storage) ?? "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  });
  const latest = useRef(names);
  const merge = (entries: ProjectName[]) => {
    const next = { ...latest.current };
    for (const entry of entries) if (!next[entry.id] || entry.updated >= next[entry.id].updated) next[entry.id] = entry;
    latest.current = next;
    setNames(next);
    try {
      localStorage.setItem(storage, JSON.stringify(next));
    } catch (e) {
      console.error("Could not remember the names", e);
    }
  };
  useEffect(() => {
    if (!owner) return;
    let active = true;
    projectNames().then(
      (entries) => active && merge(entries),
      (e) => console.error("Could not load the names", e),
    );
    return () => {
      active = false;
    };
  }, [owner]);
  return {
    names,
    rename: async (id: string, name: string) => merge([await renameProject(id, name)]),
  };
}
