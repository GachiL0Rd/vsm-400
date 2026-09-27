import { COMPETENCIES, type Competencies, WEAK_SCORE } from '../../model';
import './Radar.css';

const CX = 170;
const CY = 118;
const R = 78;

function point(index: number, radius: number): [number, number] {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / COMPETENCIES.length;
  return [CX + radius * Math.cos(angle), CY + radius * Math.sin(angle)];
}

const polygon = (radii: number[]) => radii.map((r, i) => point(i, r).join(',')).join(' ');

export function Radar({ values }: { values: Competencies }) {
  const scores = COMPETENCIES.map((c) => values[c.id]);
  const summary = COMPETENCIES.map((c) => {
    const value = values[c.id];
    return value < WEAK_SCORE ? `${c.title} ${value}, проседает` : `${c.title} ${value}`;
  }).join(', ');

  return (
    <svg
      className="radar"
      viewBox="-40 0 420 236"
      role="img"
      aria-label={`Компетенции: ${summary}`}
    >
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon
          key={k}
          points={polygon(scores.map(() => R * k))}
          fill="none"
          stroke="var(--cloud)"
          strokeWidth="1.5"
        />
      ))}
      <polygon
        points={polygon(scores.map((v) => (R * v) / 100))}
        fill="var(--ink-08)"
        stroke="var(--ink)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {COMPETENCIES.map((c, i) => {
        const value = values[c.id];
        const weak = value < WEAK_SCORE;
        const [x, y] = point(i, (R * value) / 100);
        const [lx, ly] = point(i, R + 16);
        const anchor = Math.abs(lx - CX) < 4 ? 'middle' : lx > CX ? 'start' : 'end';
        return (
          <g key={c.id}>
            <circle
              cx={x}
              cy={y}
              r="4.5"
              fill={weak ? 'var(--stop)' : 'var(--ink)'}
              stroke="var(--white)"
              strokeWidth="2"
            />
            <text
              x={lx}
              y={ly + 4}
              textAnchor={anchor}
              fontSize="12"
              fontWeight={weak ? 700 : 500}
              fill={weak ? 'var(--stop)' : 'var(--iron)'}
            >
              {c.title} {value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
