import { OutcomeTag } from '../components/OutcomeTag';
import { nextShift, runs, stats } from '../demo';
import { formatDate } from '../format';
import { COMPETENCIES, type Run } from '../model';
import { href } from '../route';
import './ShiftScreen.css';

const gameUrl = import.meta.env.VITE_GAME_URL;
const FAIL_SCORE = 30;

export function ShiftScreen() {
  const stations = [nextShift.from, ...nextShift.stops, nextShift.to];
  const [first, ...rest] = nextShift.focus.map(
    (id) => COMPETENCIES.find((c) => c.id === id)?.title ?? id,
  );
  const focus = [first, ...rest.map((title) => title.toLowerCase())].join(', ');

  return (
    <div className="screen">
      <h1 className="screen__title">Смена</h1>

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

      <section className="section" aria-labelledby="runs-title">
        <div className="section__head">
          <h2 className="section__title" id="runs-title">
            Журнал рейсов
          </h2>
          <span className="label">
            {runs.length} из {stats.runs}
          </span>
        </div>
        <table className="journal">
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
      </section>
    </div>
  );
}

function JournalRow({ run }: { run: Run }) {
  return (
    <tr className="journal__row">
      <td className="journal__date num">{formatDate(run.finishedAt)}</td>
      <td className="journal__run">
        <a className="journal__link" href={href.run(run.id)}>
          {run.route}
        </a>
        <span className="label">
          {run.train}, вагон {run.car}
        </span>
      </td>
      <td className="journal__outcome">
        <OutcomeTag outcome={run.outcome} />
      </td>
      <Score title="Безопасность" value={run.safety} />
      <Score title="Лояльность" value={run.loyalty} />
      <td className="journal__num journal__points num">+{run.points}</td>
    </tr>
  );
}

function Score({ title, value }: { title: string; value: number }) {
  return (
    <td className={`journal__num num${value < FAIL_SCORE ? ' down' : ''}`} data-label={title}>
      {value}
    </td>
  );
}
