import { TRACKS } from "../../domain/tracks.ts";
import { useT } from "../../i18n/index.tsx";
import type { Stats } from "../../domain/types.ts";

/** The momentum shape. Geometry unchanged from the original. */
export function Radar({ stats }: { stats: Stats }) {
  const t = useT();
  const size = 260;
  const c = size / 2;
  const R = 92;

  const pt = (i: number, r: number): [number, number] => {
    const a = (Math.PI * 2 * i) / TRACKS.length - Math.PI / 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };

  const poly = TRACKS.map((s, i) =>
    pt(i, (R * Math.max(4, stats[s.key].momentum)) / 100).join(","),
  ).join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="ll-radar"
      role="img"
      aria-label={t.t("momentumShape")}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon
          key={f}
          points={TRACKS.map((_, i) => pt(i, R * f).join(",")).join(" ")}
          fill="none"
          stroke="var(--rule)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />
      ))}
      {TRACKS.map((_, i) => {
        const [x, y] = pt(i, R);
        return (
          <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--rule)" strokeWidth="1" />
        );
      })}
      <polygon
        points={poly}
        fill="var(--brass)"
        fillOpacity="0.14"
        stroke="var(--brass)"
        strokeWidth="1.5"
      />
      {TRACKS.map((s, i) => {
        const [x, y] = pt(i, R + 20);
        return (
          <text
            key={s.key}
            x={x}
            y={y}
            className="ll-radar-label"
            textAnchor={x > c + 4 ? "start" : x < c - 4 ? "end" : "middle"}
            dominantBaseline="middle"
          >
            {t.track(s.key).toUpperCase()}
          </text>
        );
      })}
    </svg>
  );
}
