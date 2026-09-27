import { Icon, type IconName } from '../Icon/Icon';
import './AchievementBadge.css';

const glyphs: Record<string, IconName> = {
  'before-boarding': 'door',
  'before-complaint': 'flag',
  'clean-sweep': 'check',
  'cold-head': 'snow',
  streak: 'flame',
  detail: 'lens',
  'three-calls': 'calls',
};

export function AchievementBadge({ code, earned }: { code: string; earned: boolean }) {
  return (
    <span className={`badge ${earned ? 'badge--earned' : 'badge--locked'}`}>
      <Icon name={glyphs[code] ?? 'medal'} size={26} />
    </span>
  );
}
