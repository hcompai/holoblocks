import { useEffect, useState } from "react";
import { api, GALLERY, type Build, type BuildEvent, type RenderRequest } from "./api";

const THINKING_CHARS = 1500;

function apply(build: Build, event: BuildEvent): Build {
  switch (event.type) {
    case "hello":
    case "build": {
      const { name, prompt, builder, status, created, width, depth, height } = event.build;
      return { ...build, name, prompt, builder, status, created, width, depth, height };
    }
    case "message":
      if (build.messages.some((m) => m.at === event.message.at && m.text === event.message.text)) return build;
      return { ...build, messages: [...build.messages, event.message] };
    case "step":
      if (event.step.index < build.steps.length) return build;
      return { ...build, steps: [...build.steps, event.step], boxes: [...build.boxes, ...event.boxes] };
    case "rewind":
      return {
        ...build,
        steps: build.steps.slice(0, event.steps),
        boxes: build.boxes.filter((b) => b.step < event.steps),
      };
    case "thinking":
    case "render":
      return build;
  }
}

export interface LiveBuild {
  build: Build | null;
  /** The tail of the builder's current reasoning, streamed live. */
  thinking: string;
  /** The latest render the builder asked a viewer for. */
  renderRequest: RenderRequest | null;
}

/** The open build, kept live by its event stream; events that arrive before the first fetch are replayed on it. */
export function useBuild(id: string | null): LiveBuild {
  const [build, setBuild] = useState<Build | null>(null);
  const [thinking, setThinking] = useState("");
  const [renderRequest, setRenderRequest] = useState<RenderRequest | null>(null);

  useEffect(() => {
    setBuild(null);
    setThinking("");
    setRenderRequest(null);
    if (!id) return;
    if (GALLERY) {
      let active = true;
      api.build(id).then((fetched) => active && setBuild(fetched), console.error);
      return () => {
        active = false;
      };
    }
    let pending: BuildEvent[] | null = [];
    let current: Build | null = null;
    const source = api.events(id);
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as BuildEvent;
      if (event.type === "thinking") {
        setThinking((t) => (event.reset ? "" : t + event.text).slice(-THINKING_CHARS));
        return;
      }
      if (event.type === "render") {
        setRenderRequest(event);
        return;
      }
      if (pending) pending.push(event);
      else if (current) setBuild((current = apply(current, event)));
    };
    api.build(id).then((fetched) => {
      current = (pending ?? []).reduce(apply, fetched);
      pending = null;
      setBuild(current);
    });
    return () => source.close();
  }, [id]);

  return { build, thinking, renderRequest };
}
