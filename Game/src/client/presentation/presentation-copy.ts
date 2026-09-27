import type { PublicAttemptPhase, PublicEntityView, PublicGameState } from '../../common';

export const PRESENTATION_LOG_LIMIT = 30;
export const PRESENTATION_TOAST_LIMIT = 3;
export const TOAST_TTL_MS = 4_000;
export const SPEECH_TTL_MS = 6_000;
export const REDIRECT_DELAY_MS = 5_000;

const ACHIEVEMENT_TITLES: Readonly<Record<string, string>> = {
  'documents-perfect': 'Документы без ошибок',
  'fast-fire-response': 'Быстрая реакция на пожар',
  'safe-emergency-stop': 'Безопасная остановка',
  'all-service-requests-resolved': 'Все запросы выполнены',
  'clean-predeparture': 'Чистая приёмка',
};

/** Russian achievement title. Unknown ids stay generic. Display only. */
export function achievementTitle(achievementId: string): string {
  return ACHIEVEMENT_TITLES[achievementId] ?? 'Достижение получено';
}

/**
 * Player-facing rejection text.
 * `null` means silent (`stale-revision`). Unknown codes keep the server message.
 */
export function rejectionCopy(code: string, serverMessage: string): string | null {
  switch (code) {
    case 'stale-revision':
      return null;
    case 'action-rejected':
      return 'Действие сейчас недоступно.';
    case 'invalid-target':
      return 'Эта цель недоступна.';
    case 'unsupported-command':
      return 'Команда не поддерживается.';
    default:
      return serverMessage;
  }
}

export function phaseLabel(phase: PublicAttemptPhase): string {
  switch (phase.kind) {
    case 'pre-departure':
      return 'Приёмка вагона';
    case 'origin-stop':
      return 'Посадка';
    case 'travel':
      return 'Поездка';
    case 'stop':
      return `Остановка ${phase.stopIndex + 1}`;
    case 'finished':
      return 'Итог смены';
  }
}

export function phaseKey(phase: PublicAttemptPhase): string {
  switch (phase.kind) {
    case 'stop':
      return `stop:${phase.stopIndex}:${phase.stopId}`;
    case 'travel':
      return `travel:${phase.nextStopIndex}`;
    default:
      return phase.kind;
  }
}

export function phaseFeedText(phase: PublicAttemptPhase): string {
  return `Фаза: ${phaseLabel(phase)}`;
}

export function phaseObjective(phase: PublicAttemptPhase | null): string {
  if (phase === null) return 'Ожидание состояния сервера.';
  return 'Доступные действия появятся после выбора объекта или пассажира.';
}

export function modeLabel(kind: PublicGameState['mode']['kind']): string {
  switch (kind) {
    case 'live':
      return 'Игра';
    case 'guided':
      return 'Обучение';
    case 'replay':
      return 'Повтор';
  }
}

export function metricsLine(state: PublicGameState | null): string {
  if (state === null) return 'Данные игрового сервера загружаются';
  const passengers = state.entities.filter((entity) => entity.kind === 'passenger').length;
  const objects = state.world.objects.length;
  return `Пассажиры ${passengers} / Объекты ${objects} / ${modeLabel(state.mode.kind)}`;
}

export function heldItemName(visualId: string): string {
  const names: Record<string, string> = {
    'item.acceptance-journal': 'журнал приёмки',
    'item.extinguisher': 'огнетушитель',
    'item.drink': 'напиток',
    'item.food': 'еда',
  };
  return names[visualId] ?? 'предмет';
}

/** mm:ss of simulation time. Hours roll into minutes. */
export function formatSimClock(timeUs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeUs / 1_000_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Speaker label from public state.
 * Protocol v1 exposes `appearanceId` only, with no passenger display name.
 */
export function speakerLabel(entityId: string, entities: readonly PublicEntityView[]): string {
  const entity = entities.find((item) => item.id === entityId);
  if (entity?.kind === 'player') return 'Проводник';
  return 'Пассажир';
}
