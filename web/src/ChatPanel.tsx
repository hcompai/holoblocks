import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, type Build, type BuilderInfo } from "./api";

const SUGGESTIONS = [
  "A medieval castle with a keep, four towers and a gatehouse",
  "A Japanese temple by a pond",
  "A cozy village square with a church and a fountain",
  "A lighthouse on a rocky shore",
  "A gothic cathedral",
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
  const pickable = builders.filter((b) => !b.showcase);
  const log = useRef<HTMLDivElement>(null);
  const thought = useRef<HTMLDivElement>(null);
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
            <div className="label">Try one</div>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          build.messages.map((m) => (
            <div key={`${m.at}-${m.role}`} className={`msg ${m.role}`}>
              {m.text}
              {m.images?.length > 0 && (
                <div className={`msg-images n${m.images.length}`}>
                  {m.images.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt="" />
                    </a>
                  ))}
                </div>
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
    </div>
  );
}
