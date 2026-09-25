import {
  type Answer,
  applyChoice,
  createRun,
  currentStep,
  generateScenario,
  LESSONS,
  type LessonId,
  type LessonSummary,
  type Run,
  type Step,
} from './domain/scenarios';
import './style.css';
import { mountTrainScene } from './trainScene';

type View = 'path' | 'lesson' | 'result';
type Progress = { xp: number; completed: LessonId[] };

const STORAGE_KEY = 'smena-local-progress-v1';
function findRoot(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>('#app');
  if (!element) throw new Error('Application root not found');
  return element;
}

const root = findRoot();

function isLessonId(value: unknown): value is LessonId {
  return LESSONS.some((lesson) => lesson.id === value);
}

function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null) return { xp: 0, completed: [] };
    const data = parsed as { xp?: unknown; completed?: unknown };
    return {
      xp: typeof data.xp === 'number' && Number.isFinite(data.xp) ? Math.max(0, data.xp) : 0,
      completed: Array.isArray(data.completed)
        ? [...new Set(data.completed.filter(isLessonId))]
        : [],
    };
  } catch {
    return { xp: 0, completed: [] };
  }
}

function saveProgress(progress: Progress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // The lesson is still playable if the browser blocks local storage.
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escaped[character] ?? character;
  });
}

function delta(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}

let progress = loadProgress();
let view: View = 'path';
let feedback = false;
let run: Run | null = null;
let xpAward = 0;
let game: ReturnType<typeof mountTrainScene> | null = null;
let clock: number | undefined;
let deadline: number | undefined;

function stopClock(): void {
  if (clock !== undefined) window.clearInterval(clock);
  clock = undefined;
  deadline = undefined;
}

function unlocked(id: LessonId): boolean {
  const index = LESSONS.findIndex((lesson) => lesson.id === id);
  if (index <= 0) return true;
  const previous = LESSONS[index - 1];
  return previous !== undefined && progress.completed.includes(previous.id);
}

function header(): string {
  const level = Math.floor(progress.xp / 60) + 1;
  return `<header class='topbar'>
    <button class='brand' data-action='path' aria-label='Открыть учебный путь'>
      <span class='brand-mark' aria-hidden='true'>↗</span><span>смена<span class='brand-dot'>.</span></span>
    </button>
    <div class='header-stats'><span class='header-chip'>✦ ${progress.xp} XP</span><span class='header-chip level-chip'>Учебный уровень ${level}</span></div>
  </header>`;
}

function pathNode(lesson: LessonSummary, index: number): string {
  const complete = progress.completed.includes(lesson.id);
  const open = unlocked(lesson.id);
  const label = complete ? 'пройдено, можно повторить' : open ? 'начать урок' : 'пока закрыто';
  const icon = complete ? '✓' : lesson.icon;
  const arrow = complete ? '↻' : open ? '→' : '•';
  return `<div class='path-row ${index % 2 ? 'path-right' : 'path-left'}'>
    <span class='path-index'>0${index + 1}</span>
    <button class='path-node ${complete ? 'completed' : ''} ${open ? '' : 'locked'}'
      data-action='start' data-id='${lesson.id}' ${open ? '' : 'disabled'}
      aria-label='${escapeHtml(lesson.title)}: ${label}'>
      <span class='node-icon' aria-hidden='true'>${icon}</span>
      <span class='node-copy'><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.subtitle)}</small></span>
      <span class='node-arrow' aria-hidden='true'>${arrow}</span>
    </button>
  </div>`;
}

function path(): string {
  const done = progress.completed.length;
  const percent = Math.round((done / LESSONS.length) * 100);
  const next = LESSONS.find(
    (lesson) => unlocked(lesson.id) && !progress.completed.includes(lesson.id),
  );
  const featured = next ?? LESSONS[0];
  if (!featured) throw new Error('No lessons configured');
  const nodes = LESSONS.map(pathNode).join('');

  return `<main class='home-layout'>
    <section class='journey'>
      <div class='eyebrow'><span class='eyebrow-dot'></span> УЧЕБНЫЙ МАРШРУТ · 01</div>
      <h1>Решения, которые<br><span>меняют поездку.</span></h1>
      <p class='lead'>Короткие рабочие ситуации, последствия каждого выбора и понятный следующий шаг.</p>
      <div class='route-caption'><strong>Путь проводника</strong><span>${done} из ${LESSONS.length} уроков</span></div>
      <div class='progress-track' role='progressbar' aria-label='Прогресс маршрута' aria-valuenow='${done}' aria-valuemin='0' aria-valuemax='${LESSONS.length}'><span style='width:${percent}%'></span></div>
      <div class='path-list'>${nodes}</div>
    </section>
    <aside class='sidebar'>
      <div class='card next-card'>
        <div class='card-kicker'>ТВОЙ СЛЕДУЮЩИЙ ШАГ</div><div class='featured-icon' aria-hidden='true'>${featured.icon}</div>
        <h2>${escapeHtml(featured.title)}</h2><p>${escapeHtml(featured.subtitle)} · около 2 минут</p>
        <button class='primary-button' data-action='start' data-id='${featured.id}'>${next ? 'Начать урок' : 'Повторить урок'} <span aria-hidden='true'>→</span></button>
      </div>
      <div class='card profile-card'>
        <div class='card-kicker'>МОЙ ПРОГРЕСС</div><h2>Каждый шаг важен</h2>
        <div class='profile-stat'><span>Завершено уроков</span><strong>${done} / ${LESSONS.length}</strong></div>
        <div class='profile-stat'><span>Накоплено опыта</span><strong>${progress.xp} XP</strong></div>
        <div class='skill-tags'>${LESSONS.map((lesson) => `<span class='skill-tag ${progress.completed.includes(lesson.id) ? 'skill-done' : ''}'>${escapeHtml(lesson.skill)}</span>`).join('')}</div>
        <p class='small-note'>Ошибки можно разобрать и пройти урок снова. Повторение не ограничено.</p>
      </div>
      <p class='local-note'>Локальный прототип · материалы организатора</p>
    </aside>
  </main>`;
}

function meter(label: string, value: number, color: string): string {
  return `<div class='meter'><div class='meter-label'><span>${label}</span><strong>${value}</strong></div>
    <div class='meter-track'><span class='${color}' style='width:${value}%'></span></div></div>`;
}

function renderFeedback(last: Answer, finished: boolean): string {
  const heading = last.isTimeout ? 'ВРЕМЯ ВЫШЛО' : 'ПОСЛЕДСТВИЕ ВЫБОРА';
  return `<div class='feedback-card' role='status'>
    <div class='card-kicker'>${heading}</div>
    <h2>${escapeHtml(last.feedback)}</h2>
    <div class='delta-row'><span class='delta ${last.safety >= 0 ? 'positive' : 'negative'}'>Безопасность ${delta(last.safety)}</span>
    <span class='delta ${last.loyalty >= 0 ? 'positive' : 'negative'}'>Лояльность ${delta(last.loyalty)}</span></div>
    <button class='primary-button' data-action='continue'>${finished ? 'Посмотреть разбор' : 'Продолжить'} <span aria-hidden='true'>→</span></button>
  </div>`;
}

function renderDecision(step: Step): string {
  const options = step.choices
    .filter((option) => !option.isTimeout)
    .map(
      (option, index) => `<button class='choice-button' data-action='choice' data-id='${option.id}'>
      <span class='choice-index'>${index + 1}</span><span>${escapeHtml(option.text)}</span><span class='choice-arrow' aria-hidden='true'>›</span>
    </button>`,
    )
    .join('');
  const timerBadge = step.timeLimitSeconds
    ? `<span id='timer' class='timer' role='timer'>◷ ${step.timeLimitSeconds} с</span>`
    : '';
  return `<div class='dialogue-card'><div class='speaker'><span class='speaker-avatar' aria-hidden='true'>${step.speaker === 'Пассажир' ? 'П' : '!'}</span>${escapeHtml(step.speaker)}</div>
    <p>«${escapeHtml(step.dialogue)}»</p></div>
    <div class='decision-heading'><h2>${escapeHtml(step.prompt)}</h2>${timerBadge}</div>
    <div class='choice-list'>${options}</div>`;
}

function lesson(): string {
  if (!run) return '';
  const step = currentStep(run);
  const last = run.answers.at(-1);
  const percent = Math.min(100, run.answers.length * 50);
  if (!feedback && !step) throw new Error('Expected an active step');
  if (feedback && !last) throw new Error('Expected a previous answer');
  const mainContent =
    feedback && last ? renderFeedback(last, run.stepId === null) : renderDecision(step as Step);

  return `<main class='lesson-layout'>
    <div class='lesson-topline'><button class='back-button' data-action='path' aria-label='Выйти к учебному пути'>✕</button>
      <div class='lesson-progress'><span style='width:${percent}%'></span></div><span class='step-count'>${Math.min(run.answers.length + (feedback ? 0 : 1), 2)} / 2</span></div>
    <div class='lesson-grid'>
      <section class='lesson-main'>
        <div class='lesson-heading'><div class='eyebrow'>${escapeHtml(run.scenario.skill.toUpperCase())} · КОРОТКИЙ УРОК</div>
          <h1>${escapeHtml(run.scenario.title)}</h1><p>${escapeHtml(run.scenario.briefing)}</p></div>
        <div class='scene-card'><div id='train-scene' aria-label='Иллюстрация ситуации в вагоне'></div><span class='scene-location'>${escapeHtml(run.scenario.setting)}</span></div>
        ${mainContent}
      </section>
      <aside class='lesson-aside'><div class='card meters-card'><div class='card-kicker'>СОСТОЯНИЕ СИТУАЦИИ</div>
        ${meter('Безопасность', run.safety, 'safety-fill')}
        ${meter('Лояльность пассажира', run.loyalty, 'loyalty-fill')}
        <p>Шкалы показывают последствия решений в этом уроке.</p></div>
        <div class='tip-card'><span aria-hidden='true'>✦</span><p>Подумай, что произойдёт с пассажирами после твоего выбора.</p></div>
      </aside>
    </div>
  </main>`;
}

function result(): string {
  if (!run) return '';
  const strong = run.safety >= 70 && run.loyalty >= 70;
  const next = LESSONS[LESSONS.findIndex((lesson) => lesson.id === run?.scenario.id) + 1];
  const review = run.answers
    .map(
      (answer, index) =>
        `<div class='review-row'><span class='review-index'>0${index + 1}</span><div><strong>${escapeHtml(answer.text)}</strong>
      <p>${escapeHtml(answer.feedback)}</p></div><span class='review-delta'>${delta(answer.safety)} / ${delta(answer.loyalty)}</span></div>`,
    )
    .join('');

  return `<main class='result-layout'>
    <div class='result-symbol' aria-hidden='true'>${strong ? '✦' : '↗'}</div>
    <div class='eyebrow'>УРОК ЗАВЕРШЁН</div><h1>${strong ? 'Отличная смена!' : 'Есть что улучшить'}</h1>
    <p class='result-lead'>${strong ? 'Вы сохранили безопасность и помогли пассажирам.' : 'Разберите решения и попробуйте ещё раз — ошибки помогают учиться.'}</p>
    <div class='result-stats'><div><span>БЕЗОПАСНОСТЬ</span><strong>${run.safety}</strong></div><div><span>ЛОЯЛЬНОСТЬ</span><strong>${run.loyalty}</strong></div><div><span>ОПЫТ</span><strong>+${xpAward} XP</strong></div></div>
    <section class='review-card'><div class='card-kicker'>РАЗБОР СИТУАЦИИ</div><h2>Что повлияло на результат</h2>
      ${review}<p class='source-reference'>Основа урока: ${escapeHtml(run.scenario.source)}. Варианты и последствия адаптированы для учебного прототипа.</p></section>
    <div class='result-actions'><button class='secondary-button' data-action='retry'>Пройти ещё раз</button>
      ${next ? `<button class='primary-button' data-action='start' data-id='${next.id}'>Следующий урок <span aria-hidden='true'>→</span></button>` : `<button class='primary-button' data-action='path'>К учебному пути <span aria-hidden='true'>→</span></button>`}
    </div>
  </main>`;
}

function tick(): void {
  if (deadline === undefined || view !== 'lesson' || feedback || !run) return;
  const remaining = Math.max(0, deadline - Date.now());
  const display = document.querySelector<HTMLElement>('#timer');
  if (display) {
    display.textContent = `◷ ${Math.ceil(remaining / 1000)} с`;
    display.classList.toggle('urgent', remaining <= 5000);
  }
  if (remaining === 0) {
    const timeout = currentStep(run)?.timeoutChoiceId;
    if (timeout) choose(timeout);
  }
}

function render(): void {
  stopClock();
  game?.destroy(true);
  game = null;
  root.innerHTML = `${header()}${view === 'path' ? path() : view === 'lesson' ? lesson() : result()}`;
  if (view === 'lesson' && run) {
    game = mountTrainScene('train-scene', run.scenario.id);
    const step = currentStep(run);
    if (!feedback && step?.timeLimitSeconds && step.timeoutChoiceId) {
      deadline = Date.now() + step.timeLimitSeconds * 1000;
      clock = window.setInterval(tick, 100);
      tick();
    }
  }
}

function start(id: LessonId): void {
  if (!unlocked(id)) return;
  run = createRun(generateScenario(id));
  xpAward = 0;
  feedback = false;
  view = 'lesson';
  render();
}

function choose(id: string): void {
  if (!run || feedback) return;
  stopClock();
  run = applyChoice(run, id);
  if (run.stepId === null && !progress.completed.includes(run.scenario.id)) {
    xpAward = 20;
    progress = { xp: progress.xp + xpAward, completed: [...progress.completed, run.scenario.id] };
    saveProgress(progress);
  }
  feedback = true;
  render();
}

root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'path') {
    view = 'path';
    render();
  } else if (action === 'start' && isLessonId(button.dataset.id)) {
    start(button.dataset.id);
  } else if (action === 'choice' && button.dataset.id && !feedback) {
    choose(button.dataset.id);
  } else if (action === 'continue' && run) {
    view = run.stepId === null ? 'result' : 'lesson';
    feedback = false;
    render();
  } else if (action === 'retry' && run) {
    start(run.scenario.id);
  }
});

render();
