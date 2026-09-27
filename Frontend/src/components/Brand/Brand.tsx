import './Brand.css';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand__word">Перегон</span>
      <svg className="brand__stairs" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <rect x="0" y="14" width="6" height="6" />
        <rect x="7" y="7" width="6" height="6" />
        <rect x="14" y="0" width="6" height="6" />
      </svg>
    </span>
  );
}
