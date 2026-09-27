import { Link, useParams } from 'react-router';
import { useRun } from '../../api/cabinet';
import { ApiError } from '../../api/client';
import { Icon } from '../../components/Icon/Icon';
import { Meter } from '../../components/Meter/Meter';
import { Note } from '../../components/Note/Note';
import { NotFound } from '../../components/NotFound/NotFound';
import { OutcomeTag } from '../../components/OutcomeTag/OutcomeTag';
import { QueryState } from '../../components/QueryState/QueryState';
import { Section } from '../../components/Section/Section';
import { Tag, type TagTone } from '../../components/Tag/Tag';
import { formatDate, formatDelta, plural } from '../../format';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
  COMPETENCIES,
  type Decision,
  FAIL_SCORE,
  type Run,
  STAGE_TITLES,
  type Stage,
  scoreGrade,
  type Verdict,
} from '../../model';
import { paths } from '../../paths';
import './RunScreen.css';

const VERDICTS: Record<Verdict, { title: string; tone: TagTone }> = {
  best: { title: 'Верно', tone: 'ok' },
  ok: { title: 'Допустимо', tone: 'warn' },
  worse: { title: 'Ошибка', tone: 'stop' },
  missed: { title: 'Пропущено', tone: 'stop' },
};

const STAGE_ORDER: readonly Stage[] = ['acceptance', 'boarding', 'enroute', 'stop', 'handover'];

function readable(text: string): string {
  return text
    .replaceAll('пассажира passenger-', 'пассажира ')
    .replaceAll('пассажир passenger-', 'пассажир ')
    .replaceAll('passenger-', 'пассажир ')
    .replaceAll('cabin-fire', 'салон')
    .replaceAll('entry-pressure-leak', 'входная зона');
}

function groupByStage(decisions: readonly Decision[]): { stage: Stage; items: Decision[] }[] {
  const groups: { stage: Stage; items: Decision[] }[] = [];
  for (const stage of STAGE_ORDER) {
    const items = decisions.filter((decision) => decision.stage === stage);
    if (items.length > 0) {
      groups.push({ stage, items });
    }
  }
  return groups;
}

function missingRun(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 422);
}

export function RunScreen() {
  const { id = '' } = useParams();
  const run = useRun(id);
  const missing = !id || (run.isError && missingRun(run.error));
  usePageTitle(missing ? 'Рейс не найден' : (run.data?.outcomeNote ?? 'Рейс'));

  if (missing) return <NotFound title="Рейс не найден" />;

  return (
    <div className="screen">
      <Link className="back" to={paths.shift}>
        <Icon name="back" size={20} />
        Журнал рейсов
      </Link>
      <QueryState query={run}>{run.data && <RunBody run={run.data} />}</QueryState>
    </div>
  );
}

function RunBody({ run }: { run: Run }) {
  const groups = groupByStage(run.decisions);

  return (
    <>
      <header className="screen__head">
        <div>
          <OutcomeTag outcome={run.outcome} />
        </div>
        <h1 className="screen__title" tabIndex={-1}>
          {run.outcomeNote}
        </h1>
      </header>

      <dl className="facts">
        <div className="facts__wide">
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
        <Section id="work-title" title="Работа проводника">
          <dl className="ledger">
            {COMPETENCIES.filter((item) => run.competencyDelta[item.id] !== undefined).map(
              (item) => {
                const delta = run.competencyDelta[item.id] ?? 0;
                return (
                  <div className="ledger__row" key={item.id}>
                    <dt>{item.title}</dt>
                    <dd className={delta > 0 ? 'up' : 'down'}>{formatDelta(delta)}</dd>
                  </div>
                );
              },
            )}
          </dl>
        </Section>

        <Section id="facts-title" title="Фактический результат">
          <dl className="ledger">
            <div className="ledger__row">
              <dt>Пожар и давление без критического</dt>
              <dd>{run.facts.prevented}</dd>
            </div>
            <div className="ledger__row">
              <dt>Критический пожар и давление</dt>
              <dd className={run.facts.incidents > 0 ? 'down' : ''}>{run.facts.incidents}</dd>
            </div>
            <div className="ledger__row">
              <dt>Запросы без ответа</dt>
              <dd className={run.facts.complaints > 0 ? 'down' : ''}>{run.facts.complaints}</dd>
            </div>
            <div className="ledger__row">
              <dt>Стоп-кран приведён</dt>
              <dd>{run.facts.interventions}</dd>
            </div>
          </dl>
        </Section>
      </div>

      <Section
        id="decisions-title"
        title="Разбор решений"
        aside={
          run.decisions.length > 0 ? (
            <span className="label">
              {run.decisions.length}{' '}
              {plural(run.decisions.length, ['решение', 'решения', 'решений'])}
            </span>
          ) : undefined
        }
      >
        {groups.length === 0 ? (
          <p className="log__empty">Разбор решений для этого рейса пока недоступен.</p>
        ) : (
          groups.map((group) => (
            <section className="log-group" key={group.stage}>
              <h3 className="log-group__title">{STAGE_TITLES[group.stage]}</h3>
              <ol className="log">
                {group.items.map((decision) => (
                  <DecisionEntry decision={decision} key={decision.id} />
                ))}
              </ol>
            </section>
          ))
        )}
      </Section>
    </>
  );
}

function Scale({ title, value }: { title: string; value: number }) {
  const failed = value < FAIL_SCORE;
  return (
    <div className="scale">
      <div className="row">
        <span className="label">{title}</span>
        <b className={`scale__value scale__value--${scoreGrade(value)} num`}>
          {value}
          {failed && <span className="label down"> низкая</span>}
        </b>
      </div>
      <Meter percent={value} stop={failed} />
    </div>
  );
}

function DecisionEntry({ decision }: { decision: Decision }) {
  const verdict = VERDICTS[decision.verdict];

  return (
    <li className="log__entry">
      <div className="log__when">
        <b className="num">{decision.time}</b>
      </div>

      <div className="log__body">
        <p className="log__situation">{readable(decision.situation)}</p>
        <p className="log__action">{readable(decision.action)}</p>

        <div className="log__result">
          <Tag tone={verdict.tone}>{verdict.title}</Tag>
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

        {decision.better && (
          <Note tone="ok" title="Как следовало действовать">
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
