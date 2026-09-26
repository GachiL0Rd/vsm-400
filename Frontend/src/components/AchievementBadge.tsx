import type { Achievement } from '../model';
import { Icon, type IconName } from './Icon';
import './AchievementBadge.css';

const glyphs: Record<string, IconName> = {
  'before-boarding': 'door',
  'before-complaint': 'flag',
  'clean-sweep': 'check',
  'first-aid': 'cross',
  'cold-head': 'snow',
  streak: 'flame',
  pressure: 'ear',
  detail: 'lens',
  'three-calls': 'calls',
  rare: 'star',
};

export function AchievementBadge({ achievement }: { achievement: Achievement }) {
  const earned = achievement.earnedAt !== null;
  return (
    <span className={`badge ${earned ? 'badge--earned' : 'badge--locked'}`}>
      <Icon name={glyphs[achievement.code] ?? 'medal'} size={26} />
    </span>
  );
}
