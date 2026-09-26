import { useState } from 'react';
import { Avatar } from '../../components/Avatar/Avatar';
import { brigadeInDepot, leaderboards, profile } from '../../demo';
import { formatIn, formatNumber } from '../../format';
import { usePageTitle } from '../../hooks/usePageTitle';
import type { LeaderRow, Scope } from '../../model';
import './RatingScreen.css';

const SCOPES: { id: Scope; title: string }[] = [
  { id: 'brigade', title: 'Бригада' },
  { id: 'depot', title: 'Депо' },
  { id: 'company', title: 'Компания' },
];

export function RatingScreen() {
  usePageTitle('Рейтинг');
  const [scope, setScope] = useState<Scope>('brigade');
  const board = leaderboards[scope];
  const me = board.rows.find((r) => r.me);

  return (
    <div className="screen screen--rating">
      <header className="screen__head">
        <h1 className="screen__title" tabIndex={-1}>
          Рейтинг
        </h1>
        <p className="screen__sub">
          {board.season} закончится {formatIn(board.endsAt)}. В зачёт идут баллы за неделю.
        </p>
      </header>

      <fieldset className="segmented">
        <legend className="visually-hidden">Кого сравнивать</legend>
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`segmented__item${s.id === scope ? ' segmented__item--on' : ''}`}
            aria-pressed={s.id === scope}
            onClick={() => setScope(s.id)}
          >
            {s.title}
          </button>
        ))}
      </fieldset>

      {me && (
        <p className="rating__me">
          Вы <b className="num">{me.rank}-й</b> из {formatNumber(board.total)}
        </p>
      )}

      <ol className="board">
        {board.rows.map((row, i) => {
          const previous = board.rows[i - 1];
          const gap = previous !== undefined && row.rank - previous.rank > 1;
          return <BoardRow key={row.callsign} row={row} gapBefore={gap} />;
        })}
      </ol>

      {scope === 'brigade' && (
        <dl className="ledger rating__brigade">
          <div className="ledger__row">
            <dt>Бригада {profile.brigade} среди бригад депо</dt>
            <dd>
              {brigadeInDepot.rank}-е место из {brigadeInDepot.total}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function BoardRow({ row, gapBefore }: { row: LeaderRow; gapBefore: boolean }) {
  return (
    <li
      className={`board__row${row.me ? ' board__row--me' : ''}${gapBefore ? ' board__row--gap' : ''}`}
      value={row.rank}
    >
      <span className="board__rank num">{row.rank}</span>
      <Avatar callsign={row.callsign} size="sm" />
      <span className="board__name">
        {row.me ? <b>Вы</b> : `#${row.callsign}`}
        {row.move !== 0 && (
          <span className={`board__move num ${row.move > 0 ? 'up' : 'down'}`}>
            {row.move > 0 ? '↑' : '↓'}
            {Math.abs(row.move)}
            <span className="visually-hidden"> за сутки</span>
          </span>
        )}
      </span>
      <b className="board__points num">{formatNumber(row.points)}</b>
    </li>
  );
}
