import './Avatar.css';

interface AvatarProps {
  callsign: string;
  size?: 'sm' | 'lg';
}

export function Avatar({ callsign, size }: AvatarProps) {
  return (
    <span className={size ? `avatar avatar--${size}` : 'avatar'} aria-hidden="true">
      {callsign.slice(0, 2)}
    </span>
  );
}
