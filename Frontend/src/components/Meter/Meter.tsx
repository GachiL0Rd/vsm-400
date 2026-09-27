import './Meter.css';

interface MeterProps {
  percent: number;
  stop?: boolean;
  className?: string;
}

export function Meter({ percent, stop = false, className }: MeterProps) {
  return (
    <div className={className ? `track ${className}` : 'track'}>
      <span
        className={stop ? 'track__fill track__fill--stop' : 'track__fill'}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
