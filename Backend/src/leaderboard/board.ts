export type ScoredMember = {
  userId: string;
  points: number;
};

export type BoardMember = {
  userId: string;
  callsign: string;
  points: number;
  rank: number;
};

export type LeaderRow = {
  rank: number;
  callsign: string;
  points: number;
  move: number;
  me?: boolean;
};

export type Leaderboard = {
  seasonId: string;
  /** Название недели, например «Сезон 39». Query ?season принимает seasonId. */
  season: string;
  endsAt: string;
  total: number;
  rows: LeaderRow[];
};

/** Строго обогнал: был не выше, стал ниже по очкам. Ничья не считается обгоном. */
export function overtakenBy(
  before: ScoredMember[],
  userId: string,
  oldPoints: number,
  newPoints: number,
): ScoredMember[] {
  const passed: ScoredMember[] = [];
  for (const member of before) {
    if (member.userId === userId) {
      continue;
    }
    if (member.points >= oldPoints && member.points < newPoints) {
      passed.push(member);
    }
  }
  return passed;
}

export function parseWithScores(flat: string[]): ScoredMember[] {
  const rows: ScoredMember[] = [];
  for (let index = 0; index < flat.length; index += 2) {
    const userId = flat[index];
    const raw = flat[index + 1];
    if (userId === undefined || raw === undefined) {
      continue;
    }
    const points = Number(raw);
    if (!Number.isFinite(points)) {
      continue;
    }
    rows.push({ userId, points });
  }
  return rows;
}

function byPointsThenId(left: BoardMember, right: BoardMember): number {
  if (right.points !== left.points) {
    return right.points - left.points;
  }
  if (left.userId < right.userId) {
    return -1;
  }
  if (left.userId > right.userId) {
    return 1;
  }
  return 0;
}

function byCallsign(left: BoardMember, right: BoardMember): number {
  if (left.callsign < right.callsign) {
    return -1;
  }
  if (left.callsign > right.callsign) {
    return 1;
  }
  return 0;
}

/** Вся бригада: кто набрал очки — сверху, нули — по позывному. Ранги без дыр. */
export function rankBrigade(
  members: { id: string; callsign: string }[],
  scores: Map<string, number>,
): BoardMember[] {
  const scored: BoardMember[] = [];
  const zeros: BoardMember[] = [];
  for (const member of members) {
    const points = scores.get(member.id) ?? 0;
    const row: BoardMember = {
      userId: member.id,
      callsign: member.callsign,
      points,
      rank: 0,
    };
    if (points > 0) {
      scored.push(row);
    } else {
      zeros.push(row);
    }
  }
  scored.sort(byPointsThenId);
  zeros.sort(byCallsign);
  const ordered = scored.concat(zeros);
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    if (row) {
      row.rank = index + 1;
    }
  }
  return ordered;
}

export function rankScored(rows: ScoredMember[], callsigns: Map<string, string>): BoardMember[] {
  const ranked: BoardMember[] = [];
  for (const row of rows) {
    const callsign = callsigns.get(row.userId);
    if (!callsign) {
      continue;
    }
    ranked.push({
      userId: row.userId,
      callsign,
      points: row.points,
      rank: ranked.length + 1,
    });
  }
  return ranked;
}

/** Депо и компания: топ-5 и своя строка, если её нет в топе. */
export function topAndViewer<T extends { userId: string }>(
  rows: T[],
  viewerId: string,
  limit = 5,
): T[] {
  const top = rows.slice(0, limit);
  if (top.some((row) => row.userId === viewerId)) {
    return top;
  }
  const mine = rows.find((row) => row.userId === viewerId);
  if (!mine) {
    return top;
  }
  return top.concat(mine);
}

/** Плюс — поднялся. Нет вчерашнего снимка — 0, а не «новый рекорд». */
export function moveOf(previousRank: number | null, rank: number): number {
  if (previousRank === null) {
    return 0;
  }
  return previousRank - rank;
}

export function presentRow(row: BoardMember & { move: number }, viewerId: string): LeaderRow {
  const result: LeaderRow = {
    rank: row.rank,
    callsign: row.callsign,
    points: row.points,
    move: row.move,
  };
  if (row.userId === viewerId) {
    result.me = true;
  }
  return result;
}
