import { useLogout } from '../../api/auth';
import { useAchievements, useMe, useStats } from '../../api/cabinet';
import { AchievementBadge } from '../../components/AchievementBadge/AchievementBadge';
import { Avatar } from '../../components/Avatar/Avatar';
import { Meter } from '../../components/Meter/Meter';
import { QueryState } from '../../components/QueryState/QueryState';
import { Radar } from '../../components/Radar/Radar';
import { Section } from '../../components/Section/Section';
import { formatDate, formatDelta, formatNumber, plural } from '../../format';
import { usePageTitle } from '../../hooks/usePageTitle';
import { type Achievement, COMPETENCIES, type Profile, type Stats, WEAK_SCORE } from '../../model';
import './ProfileScreen.css';

const WEEK = [6, 5, 4, 3, 2, 1, 0];

export function ProfileScreen() {
  usePageTitle('Профиль');
  const logout = useLogout();
  const me = useMe();
  const stats = useStats();
  const achievements = useAchievements();

  return (
    <div className="screen">
      <QueryState query={me}>
        {me.data && (
          <>
            <ProfileHeader profile={me.data} />
            <ProfileFacts profile={me.data} />
            <div className="progress">
              <LevelBlock profile={me.data} />
              <StreakBlock profile={me.data} />
            </div>
            <SkillsBlock profile={me.data} />
          </>
        )}
      </QueryState>
      <QueryState query={stats}>{stats.data && <StatsBlock stats={stats.data} />}</QueryState>
      <QueryState query={achievements}>
        {achievements.data && <InsigniaBlock achievements={achievements.data} />}
      </QueryState>
      <button
        type="button"
        className="btn btn--ghost profile__logout"
        onClick={() => logout.mutate()}
      >
        Выйти
      </button>
    </div>
  );
}

function ProfileHeader({ profile }: { profile: Profile }) {
  return (
    <header className="me">
      <Avatar callsign={profile.callsign} size="lg" />
      <div>
        <h1 className="screen__title" tabIndex={-1}>
          #{profile.callsign}
        </h1>
        <p className="screen__sub">{profile.position}</p>
      </div>
    </header>
  );
}

function ProfileFacts({ profile }: { profile: Profile }) {
  return (
    <dl className="facts">
      <div>
        <dt className="label">Бригада</dt>
        <dd>{profile.brigade}</dd>
      </div>
      <div>
        <dt className="label">Депо</dt>
        <dd>{profile.depot}</dd>
      </div>
      <div>
        <dt className="label">Уровень</dt>
        <dd>{profile.level}</dd>
      </div>
      <div>
        <dt className="label">Баллы</dt>
        <dd className="num">{formatNumber(profile.points)}</dd>
      </div>
    </dl>
  );
}

// points может опуститься ниже levelFrom после сгорания. Долю из сырых баллов не берём.
function levelFill(profile: Profile): number {
  const span = profile.levelTo - profile.levelFrom;
  if (span <= 0) return 0;
  const raw = (profile.points - profile.levelFrom) / span;
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  return raw;
}

function pointsLeft(profile: Profile): number {
  const left = profile.levelTo - profile.points;
  return left > 0 ? left : 0;
}

function LevelBlock({ profile }: { profile: Profile }) {
  return (
    <Section
      id="level-title"
      title={<>До {profile.level + 1}-го уровня</>}
      aside={<span className="label num">{formatNumber(pointsLeft(profile))} баллов</span>}
    >
      <Meter percent={levelFill(profile) * 100} />
      {profile.expiring && (
        <p className="label">
          {formatDate(profile.expiring.at)} спишутся {profile.expiring.points} баллов, если до этой
          даты не будет пройдено ни одного рейса.
        </p>
      )}
    </Section>
  );
}

function StreakBlock({ profile }: { profile: Profile }) {
  const days = (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`;

  return (
    <Section
      id="streak-title"
      title="Серия"
      aside={<span className="label">{days(profile.streakDays)} подряд</span>}
    >
      <ol className="streak" aria-label="Рейсы за последние 7 дней">
        {WEEK.map((daysAgo) => {
          // Серия заканчивается вчера: сегодняшний день ещё открыт.
          const done = daysAgo > 0 && daysAgo <= profile.streakDays;
          return (
            <li
              key={daysAgo}
              className={`streak__day${done ? ' streak__day--done' : ''}${daysAgo === 0 ? ' streak__day--today' : ''}`}
            >
              <Car />
              <span className="visually-hidden">
                {daysAgo === 0 ? 'Сегодня' : `${days(daysAgo)} назад`}:{' '}
                {done ? 'был рейс' : 'рейса нет'}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="label">Рейс сегодня продлит серию до {days(profile.streakDays + 1)}.</p>
    </Section>
  );
}

function escalationPercent(stats: Stats): number {
  if (stats.escalationsTotal === 0) return 0;
  return Math.round((stats.escalationsCorrect / stats.escalationsTotal) * 100);
}

function StatsBlock({ stats }: { stats: Stats }) {
  return (
    <Section id="stats-title" title="Статистика">
      <dl className="ledger stats">
        <div className="ledger__row">
          <dt>
            Пройдено рейсов
            <span className="label ledger__note">{stats.completed} завершено</span>
          </dt>
          <dd>{stats.runs}</dd>
        </div>
        <div className="ledger__row">
          <dt>Верные журналы приёмки</dt>
          <dd>{stats.defectsFound}</dd>
        </div>
        <div className="ledger__row">
          <dt>Пропущенные решения</dt>
          <dd className="down">{stats.missedChecks}</dd>
        </div>
        <div className="ledger__row">
          <dt>Среднее время реакции</dt>
          <dd>{formatNumber(stats.avgReactionSec)} с</dd>
        </div>
        <div className="ledger__row">
          <dt>
            Верные по давлению и стоп-крану
            <span className="label ledger__note">
              {stats.escalationsCorrect} из {stats.escalationsTotal}
            </span>
          </dt>
          <dd>{escalationPercent(stats)}%</dd>
        </div>
      </dl>
    </Section>
  );
}

function SkillsBlock({ profile }: { profile: Profile }) {
  return (
    <Section
      id="skills-title"
      title="Компетенции"
      aside={<span className="label">изменение за 5 рейсов</span>}
    >
      <div className="skills">
        <Radar values={profile.competencies} />
        <ul className="skills__list">
          {COMPETENCIES.map((item) => {
            const value = profile.competencies[item.id];
            const trend = profile.trend[item.id];
            const weak = value < WEAK_SCORE;
            const note = profile.weakNote[item.id];
            return (
              <li className={`skill${weak ? ' skill--weak' : ''}`} key={item.id}>
                <div className="row">
                  <span className="skill__title">{item.title}</span>
                  <span className="skill__numbers num">
                    <span className={trend > 0 ? 'up' : trend < 0 ? 'down' : 'label'}>
                      {formatDelta(trend)}
                    </span>
                    <b>{value}</b>
                  </span>
                </div>
                <Meter percent={value} stop={weak} />
                {note && <p className="skill__note">{note}</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

function InsigniaBlock({ achievements }: { achievements: Achievement[] }) {
  const earned = achievements.filter((item) => item.earnedAt !== null);
  const locked = achievements.filter((item) => item.earnedAt === null);

  return (
    <Section
      id="ach-title"
      title="Знаки отличия"
      aside={
        <span className="label num">
          {earned.length} из {achievements.length}
        </span>
      }
    >
      <ul className="insignia">
        {[...earned, ...locked].map((item) => (
          <li
            className={`insignia__item${item.earnedAt ? '' : ' insignia__item--locked'}`}
            key={item.code}
          >
            <AchievementBadge code={item.code} earned={item.earnedAt !== null} />
            <div className="insignia__body">
              <b className="insignia__title">{item.title}</b>
              <span className="insignia__text">{item.description}</span>
              {item.earnedAt && <span className="label">Получен {formatDate(item.earnedAt)}</span>}
              {!item.earnedAt && <span className="visually-hidden">Не получен.</span>}
              {!item.earnedAt && item.progress && item.progress.total > 0 && (
                <div className="insignia__progress">
                  <Meter
                    percent={(item.progress.value / item.progress.total) * 100}
                    className="track--grow"
                  />
                  <span className="label num">
                    {item.progress.value} из {item.progress.total}
                  </span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Вагон сбоку: крыша со скруглением, двери по краям, три окна, рама, две тележки,
// сцепки. Цвет частей задаёт состояние дня в ProfileScreen.css.
function Car() {
  return (
    <svg className="car" viewBox="0 0 64 36" aria-hidden="true" focusable="false">
      <rect className="car__coupler" x="0" y="19" width="3" height="3" />
      <rect className="car__coupler" x="61" y="19" width="3" height="3" />
      <rect className="car__body" x="2" y="2" width="60" height="23" rx="5" />
      <rect className="car__glass" x="6" y="7" width="5" height="15" rx="1" />
      <rect className="car__glass" x="53" y="7" width="5" height="15" rx="1" />
      <rect className="car__glass" x="15" y="7" width="9" height="7" rx="1" />
      <rect className="car__glass" x="27.5" y="7" width="9" height="7" rx="1" />
      <rect className="car__glass" x="40" y="7" width="9" height="7" rx="1" />
      <rect className="car__frame" x="7" y="25" width="50" height="3" />
      <circle className="car__wheel" cx="14" cy="31" r="3.5" />
      <circle className="car__wheel" cx="22" cy="31" r="3.5" />
      <circle className="car__wheel" cx="42" cy="31" r="3.5" />
      <circle className="car__wheel" cx="50" cy="31" r="3.5" />
    </svg>
  );
}
