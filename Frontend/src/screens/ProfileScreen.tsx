import { AchievementBadge } from '../components/AchievementBadge';
import { Avatar } from '../components/Avatar';
import { Meter } from '../components/Meter';
import { Radar } from '../components/Radar';
import { Section } from '../components/Section';
import { achievements, profile, stats } from '../demo';
import { formatDate, formatDelta, formatNumber, plural } from '../format';
import { COMPETENCIES, WEAK_SCORE } from '../model';
import { usePageTitle } from '../usePageTitle';
import './ProfileScreen.css';

const WEEK = [6, 5, 4, 3, 2, 1, 0];

export function ProfileScreen() {
  usePageTitle('Профиль');

  return (
    <div className="screen">
      <ProfileHeader />
      <ProfileFacts />
      <div className="progress">
        <LevelBlock />
        <StreakBlock />
      </div>
      <StatsBlock />
      <SkillsBlock />
      <InsigniaBlock />
    </div>
  );
}

function ProfileHeader() {
  return (
    <header className="me">
      <Avatar callsign={profile.callsign} size="lg" />
      <div>
        <h1 className="screen__title">#{profile.callsign}</h1>
        <p className="screen__sub">{profile.position}</p>
      </div>
    </header>
  );
}

function ProfileFacts() {
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

function LevelBlock() {
  const levelShare = (profile.points - profile.levelFrom) / (profile.levelTo - profile.levelFrom);

  return (
    <Section
      id="level-title"
      title={<>До {profile.level + 1}-го уровня</>}
      aside={
        <span className="label num">{formatNumber(profile.levelTo - profile.points)} баллов</span>
      }
    >
      <Meter percent={levelShare * 100} />
      {profile.expiring && (
        <p className="label">
          {formatDate(profile.expiring.at)} спишутся {profile.expiring.points} баллов, если до этой
          даты не будет пройдено ни одного рейса.
        </p>
      )}
    </Section>
  );
}

function StreakBlock() {
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

function StatsBlock() {
  const escalationShare = Math.round((stats.escalationsCorrect / stats.escalationsTotal) * 100);

  return (
    <Section id="stats-title" title="Статистика">
      <dl className="ledger stats">
        <div className="ledger__row">
          <dt>
            Пройдено рейсов
            <span className="label ledger__note">{stats.completed} без происшествий</span>
          </dt>
          <dd>{stats.runs}</dd>
        </div>
        <div className="ledger__row">
          <dt>Найдено неисправностей</dt>
          <dd>{stats.defectsFound}</dd>
        </div>
        <div className="ledger__row">
          <dt>Пропущено обязательных проверок</dt>
          <dd className="down">{stats.missedChecks}</dd>
        </div>
        <div className="ledger__row">
          <dt>Среднее время реакции в критических ситуациях</dt>
          <dd>{formatNumber(stats.avgReactionSec)} с</dd>
        </div>
        <div className="ledger__row">
          <dt>
            Своевременные доклады
            <span className="label ledger__note">
              {stats.escalationsCorrect} из {stats.escalationsTotal}
            </span>
          </dt>
          <dd>{escalationShare}%</dd>
        </div>
        <div className="ledger__row">
          <dt>
            Нарушения без последствий
            <span className="label ledger__note">
              Ошибки, после которых ничего не случилось. В оценке учтены.
            </span>
          </dt>
          <dd className="down">{stats.luckyViolations}</dd>
        </div>
      </dl>
    </Section>
  );
}

function SkillsBlock() {
  return (
    <Section
      id="skills-title"
      title="Компетенции"
      aside={<span className="label">изменение за 5 рейсов</span>}
    >
      <div className="skills">
        <Radar values={profile.competencies} />
        <ul className="skills__list">
          {COMPETENCIES.map((c) => {
            const value = profile.competencies[c.id];
            const trend = profile.trend[c.id];
            const weak = value < WEAK_SCORE;
            const note = profile.weakNote[c.id];
            return (
              <li className={`skill${weak ? ' skill--weak' : ''}`} key={c.id}>
                <div className="row">
                  <span className="skill__title">{c.title}</span>
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

function InsigniaBlock() {
  const earned = achievements.filter((a) => a.earnedAt !== null);
  const locked = achievements.filter((a) => a.earnedAt === null);

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
        {[...earned, ...locked].map((a) => (
          <li
            className={`insignia__item${a.earnedAt ? '' : ' insignia__item--locked'}`}
            key={a.code}
          >
            <AchievementBadge code={a.code} earned={a.earnedAt !== null} />
            <div className="insignia__body">
              <b className="insignia__title">{a.title}</b>
              <span className="insignia__text">{a.description}</span>
              {a.earnedAt && <span className="label">Получен {formatDate(a.earnedAt)}</span>}
              {!a.earnedAt && a.progress && (
                <div className="insignia__progress">
                  <Meter
                    percent={(a.progress.value / a.progress.total) * 100}
                    className="track--grow"
                  />
                  <span className="label num">
                    {a.progress.value} из {a.progress.total}
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
