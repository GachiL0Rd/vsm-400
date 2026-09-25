const TOKEN_KEY = 'vsm.token';

const OUTCOMES = {
  completed: 'Завершён',
  incident: 'С происшествием',
  terminated: 'Прерван',
};

const $ = (id) => document.getElementById(id);

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function api(path, init = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401 && path !== '/auth/login') {
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function showLogin() {
  $('cabinet-view').hidden = true;
  $('login-view').hidden = false;
}

async function showCabinet() {
  $('login-view').hidden = true;
  const [me, stats, achievements, runs, config] = await Promise.all([
    api('/me'),
    api('/me/stats'),
    api('/me/achievements'),
    api('/me/runs'),
    api('/config'),
  ]);
  renderProfile(me, config);
  renderStats(stats);
  renderAchievements(achievements);
  renderRuns(runs);
  $('cabinet-view').hidden = false;
}

function renderProfile(me, config) {
  $('profile-avatar').textContent = me.displayName
    .split(' ')
    .map((part) => part[0])
    .join('');
  $('profile-name').textContent = me.displayName;
  $('profile-meta').textContent =
    `${me.position} · в системе с ${dateFormat.format(new Date(me.createdAt))}`;
  $('play').href = config.gameUrl;
}

function renderStats(stats) {
  const items = [
    ['Рейсов', stats.runs],
    ['Завершено штатно', stats.completedRuns],
    ['Безопасность, ср.', stats.avgSafetyScore ?? '—'],
    ['Сервис, ср.', stats.avgServiceScore ?? '—'],
    ['Ошибок', stats.errors],
    ['Достижений', `${stats.achievementsEarned} / ${stats.achievementsTotal}`],
  ];
  $('stats').replaceChildren(
    ...items.map(([label, value]) => {
      const item = el('div', 'stats__item');
      item.append(el('dt', 'stats__label', label), el('dd', 'stats__value', String(value)));
      return item;
    }),
  );
}

function renderAchievements(achievements) {
  $('achievements').replaceChildren(
    ...achievements.map((a) => {
      const earned = a.earnedAt !== null;
      const item = el('li', `achievement${earned ? '' : ' achievement--locked'}`);
      item.append(
        el('span', 'achievement__icon', earned ? '★' : '☆'),
        el('strong', 'achievement__title', a.title),
        el('span', 'achievement__description', a.description),
        el(
          'span',
          'achievement__date',
          earned ? `Получено ${dateFormat.format(new Date(a.earnedAt))}` : 'Не получено',
        ),
      );
      return item;
    }),
  );
}

function renderRuns(runs) {
  if (runs.length === 0) {
    $('runs').replaceChildren(el('p', 'runs__empty', 'Рейсов пока нет. Нажмите «Играть».'));
    return;
  }
  const table = el('table', 'runs__table');
  const head = el('tr');
  for (const title of ['Дата', 'Сценарий', 'Итог', 'Безопасность', 'Сервис', 'Ошибки']) {
    head.append(el('th', undefined, title));
  }
  table.append(el('thead'), el('tbody'));
  table.tHead.append(head);
  for (const run of runs) {
    const row = el('tr');
    row.append(
      el('td', undefined, dateTimeFormat.format(new Date(run.finishedAt))),
      el('td', undefined, run.scenarioId),
      el('td', `runs__outcome runs__outcome--${run.outcome}`, OUTCOMES[run.outcome] ?? run.outcome),
      el('td', undefined, String(run.safetyScore)),
      el('td', undefined, String(run.serviceScore)),
      el('td', undefined, String(run.errors)),
    );
    table.tBodies[0].append(row);
  }
  $('runs').replaceChildren(table);
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  $('login-error').textContent = '';
  try {
    const { token } = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: form.get('login'), password: form.get('password') }),
    });
    localStorage.setItem(TOKEN_KEY, token);
    formElement.reset();
    await showCabinet();
  } catch {
    $('login-error').textContent = 'Неверный логин или пароль';
  }
});

$('logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem(TOKEN_KEY);
  showLogin();
});

if (getToken()) {
  showCabinet().catch(showLogin);
} else {
  showLogin();
}
