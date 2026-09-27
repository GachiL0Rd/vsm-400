import { useState } from 'react';
import { useBrigadePlace, useLeaderboard, useMe } from '../../api/cabinet';
import { Avatar } from '../../components/Avatar/Avatar';
import { QueryState } from '../../components/QueryState/QueryState';
import { formatIn, formatNumber } from '../../format';
import { usePageTitle } from '../../hooks/usePageTitle';
import type { Leaderboard, LeaderRow, Scope } from '../../model';
import './RatingScreen.css';

const SCOPES: { id: Scope; title: string }[] = [
  { id: 'brigade', title: 'Бригада' },
  { id: 'depot', title: 'Депо' },
  { id: 'company', title: 'Компания' },
];

export function RatingScreen() {
  usePageTitle('Рейтинг');
  const [scope, setScope] = useState<Scope>('brigade');
  const board = useLeaderboard(scope);
  const data = board.data;

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="screen__title" tabIndex={-1}>
          Рейтинг
        </h1>
        {data && (
          <p className="screen__sub">
            {data.season} закончится {formatIn(data.endsAt)}. В зачёт идут баллы за неделю.
          </p>
        )}
      </header>

      <fieldset className="segmented">
        <legend className="visually-hidden">Кого сравнивать</legend>
        {SCOPES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`segmented__item${item.id === scope ? ' segmented__item--on' : ''}`}
            aria-pressed={item.id === scope}
            onClick={() => setScope(item.id)}
          >
            {item.title}
          </button>
        ))}
      </fieldset>

      <QueryState query={board}>
        {data && data.rows.length === 0 && scope === 'brigade' && (
          <p className="rating__empty">Вы пока не в бригаде.</p>
        )}
        {data && (data.rows.length > 0 || scope !== 'brigade') && <Board board={data} />}
      </QueryState>

      {scope === 'brigade' && board.isSuccess && <BrigadeLedger />}
    </div>
  );
}

function Board({ board }: { board: Leaderboard }) {
  const me = board.rows.find((row) => row.me);

  return (
    <>
      {me && (
        <p className="rating__me">
          Вы <b className="num">{me.rank}-й</b> из {formatNumber(board.total)}
        </p>
      )}
      <ol className="board">
        {board.rows.map((row, index) => {
          const previous = board.rows[index - 1];
          const gap = previous !== undefined && row.rank - previous.rank > 1;
          return <BoardRow key={row.callsign} row={row} gapBefore={gap} />;
        })}
      </ol>
    </>
  );
}

function BrigadeLedger() {
  const me = useMe();
  const place = useBrigadePlace();
  if (place.isSuccess && place.data.rank === null) return null;
  if (!place.isSuccess) return <QueryState query={place}>{null}</QueryState>;
  if (place.data.rank === null) return null;
  const rank = place.data.rank;

  return (
    <QueryState query={me}>
      {me.data && (
        <dl className="ledger rating__brigade">
          <div className="ledger__row">
            <dt>Бригада {me.data.brigade} среди бригад депо</dt>
            <dd>
              {rank}-е место из {place.data.total}
            </dd>
          </div>
        </dl>
      )}
    </QueryState>
  );
}

function BoardRow({ row, gapBefore }: { row: LeaderRow; gapBefore: boolean }) {
  return (
    <li
      className={`board__row${row.me ? ' board__row--me' : ''}${gapBefore ? ' board__row--gap' : ''}`}
      value={row.rank}
    >
      <span className="board__rank num">{row.rank <= 3 ? <Cup rank={row.rank} /> : row.rank}</span>
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

const CUPS = ['gold', 'silver', 'bronze'] as const;

// Первые три места — кубок вместо номера. Номер остаётся для чтения с экрана.
function Cup({ rank }: { rank: number }) {
  const tone = CUPS[rank - 1];
  if (!tone) return rank;
  return (
    <span className={`cup cup--${tone}`}>
      <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false">
        <path
          className="cup__handles"
          d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11"
        />
        <path
          className="cup__body"
          d="M7 3.5h10V9a5 5 0 0 1-10 0V3.5ZM11 13.8h2V17h-2ZM8 17.5h8v3H8Z"
        />
      </svg>
      <span className="visually-hidden">{rank}</span>
    </span>
  );
}
