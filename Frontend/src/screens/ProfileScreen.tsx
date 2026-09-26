import { AchievementBadge } from '../components/AchievementBadge';
import { Radar } from '../components/Radar';
import { achievements, profile, stats } from '../demo';
import { formatDate, formatDelta, formatNumber, plural } from '../format';
import { COMPETENCIES, WEAK_SCORE } from '../model';
import './ProfileScreen.css';

const WEEK = [6, 5, 4, 3, 2, 1, 0];

export function ProfileScreen() {
  const earned = achievements.filter((a) => a.earnedAt !== null);
  const locked = achievements.filter((a) => a.earnedAt === null);
  const levelShare = (profile.points - profile.levelFrom) / (profile.levelTo - profile.levelFrom);
  const escalationShare = Math.round((stats.escalationsCorrect / stats.escalationsTotal) * 100);
  const days = (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`;

  return (
    <div className="screen">
      <header className="me">
        <span className="avatar me__avatar">{profile.callsign.slice(0, 2)}</span>
        <div>
          <h1 className="screen__title">#{profile.callsign}</h1>
          <p className="screen__sub">{profile.position}</p>
        </div>
      </header>

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

      <div className="progress">
        <section className="section" aria-labelledby="level-title">
          <div className="section__head">
            <h2 className="section__title" id="level-title">
              До {profile.level + 1}-го уровня
            </h2>
            <span className="label num">
              {formatNumber(profile.levelTo - profile.points)} баллов
            </span>
          </div>
          <div className="track">
            <span className="track__fill" style={{ width: `${levelShare * 100}%` }} />
          </div>
          {profile.expiring && (
            <p className="label">
              {formatDate(profile.expiring.at)} спишутся {profile.expiring.points} баллов, если до
              этой даты не будет пройдено ни одного рейса.
            </p>
          )}
        </section>

        <section className="section" aria-labelledby="streak-title">
          <div className="section__head">
            <h2 className="section__title" id="streak-title">
              Серия
            </h2>
            <span className="label">{days(profile.streakDays)} подряд</span>
          </div>
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
        </section>
      </div>

      <section className="section" aria-labelledby="stats-title">
        <div className="section__head">
          <h2 className="section__title" id="stats-title">
            Статистика
          </h2>
        </div>
        <dl className="ledger stats">
          <div className="ledger__row">
            <dt>
              Пройдено рейсов
              <span className="ledger__note">{stats.completed} без происшествий</span>
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
            <dd>{stats.avgReactionSec.toLocaleString('ru-RU')} с</dd>
          </div>
          <div className="ledger__row">
            <dt>
              Своевременные доклады
              <span className="ledger__note">
                {stats.escalationsCorrect} из {stats.escalationsTotal}
              </span>
            </dt>
            <dd>{escalationShare}%</dd>
          </div>
          <div className="ledger__row">
            <dt>
              Нарушения без последствий
              <span className="ledger__note">
                Ошибки, после которых ничего не случилось. В оценке учтены.
              </span>
            </dt>
            <dd className="down">{stats.luckyViolations}</dd>
          </div>
        </dl>
      </section>

      <section className="section" aria-labelledby="skills-title">
        <div className="section__head">
          <h2 className="section__title" id="skills-title">
            Компетенции
          </h2>
          <span className="label">изменение за 5 рейсов</span>
        </div>
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
                  <div className="track">
                    <span
                      className={`track__fill${weak ? ' track__fill--stop' : ''}`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  {note && <p className="skill__note">{note}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="ach-title">
        <div className="section__head">
          <h2 className="section__title" id="ach-title">
            Знаки отличия
          </h2>
          <span className="label num">
            {earned.length} из {achievements.length}
          </span>
        </div>
        <ul className="insignia">
          {[...earned, ...locked].map((a) => (
            <li
              className={`insignia__item${a.earnedAt ? '' : ' insignia__item--locked'}`}
              key={a.code}
            >
              <AchievementBadge achievement={a} />
              <div className="insignia__body">
                <b className="insignia__title">{a.title}</b>
                <span className="insignia__text">{a.description}</span>
                {a.earnedAt && <span className="label">Получен {formatDate(a.earnedAt)}</span>}
                {!a.earnedAt && a.progress && (
                  <span className="insignia__progress">
                    <span className="track">
                      <span
                        className="track__fill"
                        style={{ width: `${(a.progress.value / a.progress.total) * 100}%` }}
                      />
                    </span>
                    <span className="label num">
                      {a.progress.value} из {a.progress.total}
                    </span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
