import type { HaiAgents } from "hai-agents";

/** The few phases of a build, as the chat's live line names them. */
export const PHASES = {
  idea: "Reading your idea",
  message: "Reading your message",
  setup: "Preparing blocks",
  photos: "Finding photos",
  naming: "Naming it",
  draft: "Building first draft",
  blocks: "Placing blocks",
  checking: "Checking every side",
} as const;

type Phase = (typeof PHASES)[keyof typeof PHASES];

/** A tool call as the builder's work log says it, and its phase; a null phase carries on the one before. */
interface Doing {
  label: string;
  phase: Phase | null;
}

const file = (path: string) => path.split("/").pop() || "a file";

function host(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
}

const quiet = (label: string): Doing => ({ label, phase: null });

function command(line: string): Doing {
  if (line.includes("setup.sh")) return { label: PHASES.setup, phase: PHASES.setup };
  if (/\bblocks run\b/.test(line)) return { label: "Building the model", phase: PHASES.blocks };
  if (/\bblocks find\b/.test(line)) return quiet("Looking up blocks");
  if (/\bblocks name\b/.test(line)) return { label: "Naming the build", phase: PHASES.naming };
  if (/\bcurl\b/.test(line)) return { label: "Downloading photos", phase: PHASES.photos };
  return quiet("Working on it");
}

/** What the builder does with a tool call. */
export function doing({ toolName, args = {} }: HaiAgents.ToolRequest): Doing {
  const path = String(args.path ?? args.file_path ?? args.source ?? "");
  const script = path.endsWith("build.py");
  const showcase = path.includes("showcase/");
  switch (toolName) {
    case "shell":
      return command(String(args.command ?? ""));
    case "poll_execution":
      return quiet("Still working");
    case "read_file":
      if (script) return quiet("Reading the build script");
      return quiet(showcase ? "Studying a showcase" : `Reading ${file(path)}`);
    case "write_file":
    case "search_replace":
      if (script)
        return {
          label: toolName === "write_file" ? "Writing the build script" : "Editing the build script",
          phase: PHASES.blocks,
        };
      return quiet(`Writing ${file(path)}`);
    case "view_image":
      return quiet(showcase ? "Studying a showcase" : "Studying a photo");
    case "share_files":
      return JSON.stringify(args).includes("model.json.gz")
        ? { label: "Showing you the model", phase: PHASES.blocks }
        : quiet("Showing you a reference");
    case "look":
      return { label: "Looking at the model", phase: PHASES.checking };
    case "web_search":
      return { label: args.query ? `Searching “${args.query}”` : "Searching the web", phase: PHASES.photos };
    case "web_fetch":
      return { label: `Reading ${host(args.url)}`, phase: PHASES.photos };
    default:
      return quiet(toolName.replaceAll("_", " "));
  }
}
