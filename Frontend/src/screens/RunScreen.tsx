import { Icon } from '../components/Icon';
import { Note } from '../components/Note';
import { NotFound } from '../components/NotFound';
import { OutcomeTag } from '../components/OutcomeTag';
import { runs } from '../demo';
import { formatDate, formatDelta, plural } from '../format';
import { COMPETENCIES, type Decision, STAGE_TITLES, type Verdict } from '../model';
import { href } from '../route';
import './RunScreen.css';

const VERDICTS: Record<Verdict, { title: string; tone: string }> = {
  best: { title: 'Верно', tone: 'tag--ok' },
  ok: { title: 'Допустимо', tone: 'tag--warn' },
  worse: { title: 'Ошибка', tone: 'tag--stop' },
  missed: { title: 'Пропущено', tone: 'tag--stop' },
};

const FAIL_SCORE = 30;

export function RunScreen({ id }: { id: string }) {
  const run = runs.find((r) => r.id === id);
  if (!run) return <NotFound title="Рейс не найден" />;

  const lucky = run.decisions.filter((d) => d.lucky).length;

  return (
    <div className="screen">
      <a className="back" href={href.shift}>
        <Icon name="back" size={20} />
        Журнал рейсов
      </a>

      <header className="screen__head">
        <div>
          <OutcomeTag outcome={run.outcome} />
        </div>
        <h1 className="screen__title">{run.outcomeNote}</h1>
      </header>

      <dl className="facts">
        <div>
          <dt className="label">Маршрут</dt>
          <dd>{run.route}</dd>
        </div>
        <div>
          <dt className="label">Поезд</dt>
          <dd>{run.train}</dd>
        </div>
        <div>
          <dt className="label">Вагон</dt>
          <dd>
            {run.car}, {run.carClass.toLowerCase()}
          </dd>
        </div>
        <div>
          <dt className="label">Дата</dt>
          <dd>{formatDate(run.finishedAt)}</dd>
        </div>
      </dl>

      <div className="scores">
        <Scale title="Безопасность" value={run.safety} />
        <Scale title="Лояльность пассажиров" value={run.loyalty} />
        <div className="scores__points">
          <span className="label">Начислено</span>
          <b className="num">+{run.points} баллов</b>
        </div>
      </div>

      <div className="report">
        <section className="section" aria-labelledby="work-title">
          <div className="section__head">
            <h2 className="section__title" id="work-title">
              Работа проводника
            </h2>
          </div>
          <dl className="ledger">
            {COMPETENCIES.filter((c) => run.competencyDelta[c.id] !== undefined).map((c) => {
              const delta = run.competencyDelta[c.id] ?? 0;
              return (
                <div className="ledger__row" key={c.id}>
                  <dt>{c.title}</dt>
                  <dd className={delta > 0 ? 'up' : 'down'}>{formatDelta(delta)}</dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section className="section" aria-labelledby="facts-title">
          <div className="section__head">
            <h2 className="section__title" id="facts-title">
              Фактический результат
            </h2>
          </div>
          <dl className="ledger">
            <div className="ledger__row">
              <dt>Предотвращено ситуаций</dt>
              <dd>{run.facts.prevented}</dd>
            </div>
            <div className="ledger__row">
              <dt>Инциденты</dt>
              <dd className={run.facts.incidents > 0 ? 'down' : ''}>{run.facts.incidents}</dd>
            </div>
            <div className="ledger__row">
              <dt>Жалобы пассажиров</dt>
              <dd className={run.facts.complaints > 0 ? 'down' : ''}>{run.facts.complaints}</dd>
            </div>
            <div className="ledger__row">
              <dt>Вмешательства бригады</dt>
              <dd className={run.facts.interventions > 0 ? 'down' : ''}>
                {run.facts.interventions}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {lucky > 0 && (
        <Note tone="warn">
          {lucky === 1
            ? 'Одно нарушение не привело к последствиям.'
            : `${lucky} ${plural(lucky, ['нарушение', 'нарушения', 'нарушений'])} не привели к последствиям.`}{' '}
          В оценке это учтено: в другом рейсе то же решение может закончиться инцидентом.
        </Note>
      )}

      <section className="section" aria-labelledby="decisions-title">
        <div className="section__head">
          <h2 className="section__title" id="decisions-title">
            Разбор решений
          </h2>
          <span className="label">
            {run.decisions.length} {plural(run.decisions.length, ['решение', 'решения', 'решений'])}
          </span>
        </div>
        <ol className="log">
          {run.decisions.map((decision) => (
            <DecisionEntry decision={decision} key={decision.id} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function Scale({ title, value }: { title: string; value: number }) {
  const failed = value < FAIL_SCORE;
  return (
    <div className="scale">
      <div className="row">
        <span className="label">{title}</span>
        <b className={`scale__value num${failed ? ' down' : ''}`}>{value}</b>
      </div>
      <div className="track">
        <span
          className={`track__fill${failed ? ' track__fill--stop' : ''}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function DecisionEntry({ decision }: { decision: Decision }) {
  const verdict = VERDICTS[decision.verdict];

  return (
    <li className="log__entry">
      <div className="log__when">
        <b className="num">{decision.time}</b>
        <span className="label">{STAGE_TITLES[decision.stage]}</span>
      </div>

      <div className="log__body">
        <p className="log__situation">{decision.situation}</p>
        <p className="log__action">{decision.action}</p>

        <div className="log__result">
          <span className={`tag ${verdict.tone}`}>{verdict.title}</span>
          <dl className="metrics">
            <Delta title="Безопасность" value={decision.safety} />
            <Delta title="Лояльность" value={decision.loyalty} />
            {decision.reactionSec !== undefined && (
              <div>
                <dt>Реакция</dt>
                <dd>{decision.reactionSec} с</dd>
              </div>
            )}
          </dl>
        </div>

        {decision.consequence && (
          <Note title="Последствия">
            {decision.consequence}
            {decision.lucky && ' Обошлось, но нарушение учтено.'}
          </Note>
        )}

        {decision.better && (
          <Note tone="ok" title="Как следовало действовать" source={decision.basis}>
            {decision.better}
          </Note>
        )}
      </div>
    </li>
  );
}

function Delta({ title, value }: { title: string; value: number }) {
  if (value === 0) return null;
  return (
    <div>
      <dt>{title}</dt>
      <dd className={value > 0 ? 'up' : 'down'}>{formatDelta(value)}</dd>
    </div>
  );
}
