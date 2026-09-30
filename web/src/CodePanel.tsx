import { useEffect, useRef } from "react";
import type { Build } from "./model";

interface Props {
  build: Build;
  step: number;
  onStep: (step: number) => void;
}

export function CodePanel({ build, step, onStep }: Props) {
  const steps = build.steps.filter((s) => s.code);
  const active = useRef<HTMLElement>(null);

  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [step]);

  return (
    <div className="code">
      <div className="parts-head">
        <b>{steps.length} scripted steps</b>
        <span className="muted">Each step is Python that places blocks with fill and set</span>
      </div>
      {steps.map((s) => (
        <section key={s.index} ref={s.index === step ? active : undefined} className={s.index === step ? "active" : ""}>
          <h3>
            <button aria-current={s.index === step ? "step" : undefined} onClick={() => onStep(s.index)}>
              <span className="muted">{s.index + 1}</span> {s.title}
            </button>
          </h3>
          <pre>{s.code}</pre>
        </section>
      ))}
    </div>
  );
}
