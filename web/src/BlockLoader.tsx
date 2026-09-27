const FACES = ["front", "right", "back", "left", "top", "bottom"];

export function BlockLoader({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="loader" role="status">
      <div className="cube-hop">
        <div className="cube">
          {FACES.map((f) => (
            <div key={f} className={`face ${f}`} />
          ))}
        </div>
      </div>
      <div className="cube-shadow" />
      <span className="shimmer">{label}</span>
      {detail && <span className="muted small">{detail}</span>}
    </div>
  );
}
