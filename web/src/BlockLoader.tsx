const FACES = ["front", "right", "back", "left", "top", "bottom"];

export function Cube() {
  return (
    <div className="cube">
      {FACES.map((f) => (
        <div key={f} className={`face ${f}`} />
      ))}
    </div>
  );
}

export function BlockLoader({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="loader" role="status">
      <div className="cube-hop">
        <Cube />
      </div>
      <div className="cube-shadow" />
      <span className="shimmer">{label}</span>
      {detail && <span className="muted small">{detail}</span>}
    </div>
  );
}
