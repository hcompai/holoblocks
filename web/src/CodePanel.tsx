import type { Build } from "./api";

interface Props {
  build: Build;
  step: number;
  onStep: (step: number) => void;
}

export function CodePanel({ build, step, onStep }: Props) {
  const steps = build.steps.filter((s) => s.code);
  return (
    <div className="code">
      <div className="parts-head">
        <b>{steps.length} scripted steps</b>
        <span className="muted">Each step is JavaScript that places blocks with fill and set</span>
      </div>
      {steps.map((s) => (
        <section key={s.index} className={s.index === step ? "active" : ""} onClick={() => onStep(s.index)}>
          <h3>
            <span className="muted">{s.index}</span> {s.title}
          </h3>
          <pre>{s.code}</pre>
        </section>
      ))}
    </div>
  );
}
