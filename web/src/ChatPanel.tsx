import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, GALLERY, type Build, type BuilderInfo } from "./api";

const SUGGESTIONS = [
  {
    label: "A medieval castle with a keep, four towers and a gatehouse",
    prompt:
      "A medieval castle crowning a rocky hill: a tall square keep off center, four round towers of different heights with conical slate roofs, and a gatehouse with a portcullis, a drawbridge and a winding approach road. Weathered curtain walls with crenellations, arrow slits and a wall walk; a courtyard with a well, a stable, market stalls and banners. Outcrops, ivy, scattered pines and a village of timber houses clinging to the slope below.",
  },
  {
    label: "A Japanese temple by a pond",
    prompt:
      "A Japanese Buddhist temple beside a koi pond: a two-tier main hall with deep curved eaves, dark timber posts, white plaster walls and a veranda on stone footings, a five-storey pagoda rising behind it, and a red torii gate at the end of a stone path. The pond has irregular rocky banks, a red arched bridge, lily pads and stone lanterns. Cherry trees in bloom, sculpted pines, moss, a raked gravel garden and a bamboo grove at the edge.",
  },
  {
    label: "A cozy village square with a church and a fountain",
    prompt:
      "A cozy European village square on uneven cobblestones: a stone church with a tall bell tower and a spire, a tiered fountain in the middle, and a ring of crooked timber-framed houses with jettied upper floors, flower boxes, shutters, awnings and chimneys, each a different height and color. Market stalls with crates and barrels, a bakery with a lit window, lanterns on posts, benches, a big shade tree and narrow lanes leading out between the houses.",
  },
  {
    label: "A lighthouse on a rocky shore",
    prompt:
      "A tall striped lighthouse on a jagged rocky headland: a tapering round tower with a gallery, a railing and a glowing lantern room under a domed cap, and a keeper's cottage with a slate roof, a chimney and a small garden beside it. Waves breaking on layered cliffs, tide pools, a wooden jetty with a moored rowboat, stairs cut into the rock, wind-bent grass, driftwood, fishing nets and lamps along the path.",
  },
  {
    label: "A gothic cathedral",
    prompt:
      "A soaring gothic cathedral: a western facade with twin spired towers, a great rose window and three deep pointed portals lined with statues, a long nave with tall lancet windows, flying buttresses and pinnacles along both sides, and a central spire over the crossing. Steep dark roofs, gargoyles, a cloister garden with arcades on one side, a small graveyard with yews and lanterns, and a plaza of worn paving with steps up to the doors.",
  },
];

interface Props {
  build: Build | null;
  thinking: string;
  onCreate: (prompt: string, builder: string) => void;
  onSay: (text: string) => void;
}

export function ChatPanel({ build, thinking, onCreate, onSay }: Props) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"change" | "new">("change");
  const [builders, setBuilders] = useState<BuilderInfo[]>([]);
  const [builder, setBuilder] = useState("");
  const [zoomed, setZoomed] = useState<string | null>(null);
  const pickable = builders.filter((b) => !b.showcase);
  const log = useRef<HTMLDivElement>(null);
  const thought = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const busy = build?.status === "building";
  const target = build && mode === "change" ? "change" : "new";

  useEffect(() => {
    api.builders().then((list) => {
      setBuilders(list);
      setBuilder((b) => b || (list.find((x) => !x.showcase) ?? list[0])?.name || "");
    });
  }, []);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [build?.messages.length, busy]);

  useEffect(() => {
    thought.current?.scrollTo({ top: thought.current.scrollHeight });
  }, [thinking]);

  useEffect(() => {
    if (!zoomed) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [zoomed]);

  const send = (value = text) => {
    const prompt = value.trim();
    if (!prompt || (busy && target === "change")) return;
    if (target === "change") onSay(prompt);
    else onCreate(prompt, builder);
    setText("");
    setMode("change");
  };

  const who = builders.find((b) => b.name === (build?.builder ?? builder))?.label ?? build?.builder ?? "Builder";

  return (
    <div className="chat">
      <div className="chat-log" ref={log}>
        {!build ? (
          <div className="chat-intro">
            <h2>What should we build?</h2>
            <p>Describe a structure. The builder writes it in code, block by block, while you watch it rise.</p>
            {!GALLERY && (
              <>
                <div className="label">Try one</div>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => {
                        setText(s.prompt);
                        composer.current?.focus();
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          build.messages.map((m) => (
            <div key={`${m.at}-${m.role}`} className={`msg ${m.role}`}>
              {m.text}
              {m.image && (
                <button className="msg-render" title="Open the render" onClick={() => setZoomed(m.image!)}>
                  <img src={m.image} alt="Render" loading="lazy" />
                </button>
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="msg assistant thinking">
            <div className="thinking-head">
              <span className="pulse" />
              {who} is {thinking ? "thinking" : "working"}…
            </div>
            {thinking && (
              <div className="thinking-text" ref={thought}>
                {thinking}
              </div>
            )}
          </div>
        )}
      </div>
      {zoomed &&
        createPortal(
          <div className="lightbox" onClick={() => setZoomed(null)}>
            <img src={zoomed} alt="Render" />
          </div>,
          document.body,
        )}
      {GALLERY ? (
        <p className="gallery-note">Read-only gallery. New builds run in the local app.</p>
      ) : (
        <div className="composer">
          <div className="modes">
            {build && (
              <>
                <button className={mode === "change" ? "active" : ""} onClick={() => setMode("change")}>
                  Change this build
                </button>
                <button className={mode === "new" ? "active" : ""} onClick={() => setMode("new")}>
                  Start a new build
                </button>
              </>
            )}
            {target === "new" && pickable.length > 1 && (
              <select className="builder-select" value={builder} onChange={(e) => setBuilder(e.target.value)}>
                {pickable.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <textarea
            ref={composer}
            value={text}
            placeholder={target === "change" ? "Describe how to change it…" : "Describe what to build…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy && build && target === "change" ? (
            <button className="send stop" onClick={() => api.stop(build.id)}>
              <StopIcon size={14} weight="fill" />
              Stop
            </button>
          ) : (
            <button className="send" disabled={!text.trim()} onClick={() => send()}>
              Send
              <ArrowUpIcon size={14} weight="bold" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
