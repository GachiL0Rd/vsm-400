import { Link } from 'react-router';
import { OutcomeTag } from '../../components/OutcomeTag/OutcomeTag';
import { Section } from '../../components/Section/Section';
import { nextShift, runs, stats } from '../../demo';
import { formatDate } from '../../format';
import { usePageTitle } from '../../hooks/usePageTitle';
import { COMPETENCIES, FAIL_SCORE, type Run } from '../../model';
import { paths } from '../../paths';
import './ShiftScreen.css';

const gameUrl = import.meta.env.VITE_GAME_URL;

export function ShiftScreen() {
  usePageTitle('Смена');
  const stations = [nextShift.from, ...nextShift.stops, nextShift.to];
  const [first, ...rest] = nextShift.focus.map(
    (id) => COMPETENCIES.find((c) => c.id === id)?.title ?? id,
  );
  const focus = [first, ...rest.map((title) => title.toLowerCase())].join(', ');

  return (
    <div className="screen screen--shift">
      <h1 className="screen__title" tabIndex={-1}>
        Смена
      </h1>

      <section className="departure" aria-labelledby="next-title">
        <p className="departure__label">Следующий рейс</p>
        <div className="departure__main">
          <span className="departure__time num">{nextShift.departure}</span>
          <div>
            <h2 className="departure__to" id="next-title">
              {nextShift.to}
            </h2>
            <p className="departure__from">
              из {nextShift.fromGenitive}, поезд {nextShift.train}
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
            <dd>{nextShift.car}</dd>
          </div>
          <div>
            <dt>Класс</dt>
            <dd>{nextShift.carClass}</dd>
          </div>
          <div className="departure__focus">
            <dt>Отработка</dt>
            <dd>{focus}</dd>
          </div>
        </dl>

        {gameUrl ? (
          <a className="btn departure__start" href={gameUrl}>
            Начать смену
          </a>
        ) : (
          <span className="btn departure__start" aria-disabled="true">
            Игра недоступна
          </span>
        )}
      </section>

      <Section
        id="runs-title"
        title="Журнал рейсов"
        aside={
          <span className="label">
            {runs.length} из {stats.runs}
          </span>
        }
      >
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
      </Section>
    </div>
  );
}

function JournalRow({ run }: { run: Run }) {
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
  const failed = value < FAIL_SCORE;
  return (
    <td className="journal__num num" data-label={title}>
      <span className={failed ? 'journal__bad num' : 'num'}>
        {value}
        {failed && <span className="label"> низкая</span>}
      </span>
    </td>
  );
}
