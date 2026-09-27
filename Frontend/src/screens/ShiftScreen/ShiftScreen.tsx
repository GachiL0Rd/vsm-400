import { Link } from 'react-router';
import type { RunPage } from '../../api/cabinet';
import { useNextShift, useRuns, useStartShift } from '../../api/cabinet';
import { ApiError } from '../../api/client';
import { OutcomeTag } from '../../components/OutcomeTag/OutcomeTag';
import { QueryState } from '../../components/QueryState/QueryState';
import { Section } from '../../components/Section/Section';
import { formatDate } from '../../format';
import { usePageTitle } from '../../hooks/usePageTitle';
import { COMPETENCIES, FAIL_SCORE, type NextShift, type RunSummary } from '../../model';
import { paths } from '../../paths';
import './ShiftScreen.css';

function startMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 0) return 'Нет связи с сервером.';
  return 'Не удалось начать смену. Попробуйте ещё раз.';
}

function focusLine(ids: NextShift['focus']): string {
  const titles = ids.map((id) => COMPETENCIES.find((row) => row.id === id)?.title ?? id);
  const first = titles[0];
  if (!first) return '';
  return [first, ...titles.slice(1).map((title) => title.toLowerCase())].join(', ');
}

export function ShiftScreen() {
  usePageTitle('Смена');
  const shift = useNextShift();
  const runs = useRuns();
  const pages = runs.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;
  const loaded = pages.reduce((sum, page) => sum + page.runs.length, 0);

  return (
    <div className="screen">
      <h1 className="screen__title" tabIndex={-1}>
        Смена
      </h1>

      <QueryState query={shift}>{shift.data && <Departure next={shift.data} />}</QueryState>

      <Section
        id="runs-title"
        title="Журнал рейсов"
        aside={
          runs.isSuccess ? (
            <span className="label">
              {loaded} из {total}
            </span>
          ) : undefined
        }
      >
        <QueryState query={runs}>
          {runs.data && (
            <Journal
              pages={runs.data.pages}
              hasNext={runs.hasNextPage}
              loadingNext={runs.isFetchingNextPage}
              onNext={() => runs.fetchNextPage()}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function Departure({ next }: { next: NextShift }) {
  const start = useStartShift();
  const stations = [next.from, ...next.stops, next.to];
  const pending = start.isPending;
  const error = start.isError ? startMessage(start.error) : null;

  return (
    <section className="departure" aria-labelledby="next-title">
      <p className="departure__label">Следующий рейс</p>
      <div className="departure__main">
        <time className="departure__time num" dateTime={next.departureAt}>
          {next.departure}
        </time>
        <div>
          <h2 className="departure__to" id="next-title">
            {next.to}
          </h2>
          <p className="departure__from">
            из {next.fromGenitive}, поезд {next.train}
          </p>
          <p className="departure__level">
            Приёмка вагона, посадка, путь с обслуживанием, пожар и давление.
          </p>
        </div>
      </div>

      <ol className="line" aria-label="Остановки">
        {stations.map((station) => (
          <li className="line__stop" key={station}>
            {station}
          </li>
        ))}
      </ol>

      <dl className="facts departure__facts">
        <div>
          <dt>Вагон</dt>
          <dd>{next.car}</dd>
        </div>
        <div>
          <dt>Класс</dt>
          <dd>{next.carClass}</dd>
        </div>
        <div className="departure__focus">
          <dt>Отработка</dt>
          <dd>{focusLine(next.focus)}</dd>
        </div>
      </dl>

      <button
        className="btn departure__start"
        type="button"
        onClick={() => {
          start.mutate(undefined, {
            onSuccess: (data) => {
              window.location.assign(data.launchUrl);
            },
          });
        }}
        disabled={pending}
        aria-busy={pending}
        aria-describedby={error ? 'start-error' : undefined}
      >
        {pending ? 'Готовим смену…' : 'Начать смену'}
      </button>
      {error && (
        <p className="departure__error" id="start-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Journal({
  pages,
  hasNext,
  loadingNext,
  onNext,
}: {
  pages: RunPage[];
  hasNext: boolean;
  loadingNext: boolean;
  onNext: () => void;
}) {
  const runs = pages.flatMap((page) => page.runs);
  if (runs.length === 0) return <p className="query-state">Рейсов пока нет.</p>;

  return (
    <>
      <table className="journal" aria-labelledby="runs-title">
        <thead>
          <tr>
            <th scope="col">Дата</th>
            <th scope="col">Рейс</th>
            <th scope="col">Итог</th>
            <th scope="col" className="journal__num">
              Безопасность
            </th>
            <th scope="col" className="journal__num">
              Лояльность
            </th>
            <th scope="col" className="journal__num">
              Баллы
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <JournalRow run={run} key={run.id} />
          ))}
        </tbody>
      </table>
      {hasNext && (
        <button
          className="btn btn--ghost journal-more"
          type="button"
          onClick={onNext}
          disabled={loadingNext}
        >
          Показать ещё
        </button>
      )}
    </>
  );
}

function JournalRow({ run }: { run: RunSummary }) {
  return (
    <tr className="journal__row">
      <td className="journal__date num">{formatDate(run.finishedAt)}</td>
      <td className="journal__run">
        <Link className="journal__link" to={paths.run(run.id)}>
          {run.route}
        </Link>
        <span className="label journal__train">
          {run.train}, вагон {run.car}
        </span>
      </td>
      <td className="journal__outcome">
        <OutcomeTag outcome={run.outcome} />
      </td>
      <Score title="Безопасность" value={run.safety} />
      <Score title="Лояльность" value={run.loyalty} />
      <td className="journal__num journal__points num">
        <span className="visually-hidden">Баллы </span>+{run.points}
      </td>
    </tr>
  );
}

function Score({ title, value }: { title: string; value: number }) {
  return (
    <td className={`journal__num num${value < FAIL_SCORE ? ' down' : ''}`} data-label={title}>
      {value}
      {value < FAIL_SCORE && <span className="label down"> низкая</span>}
    </td>
  );
}
