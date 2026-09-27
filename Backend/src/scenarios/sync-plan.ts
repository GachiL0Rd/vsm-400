import type { ScenarioGraph } from '../engine/schema';
import { graphChecksum } from './checksum';

export type KnownVersion = {
  version: number;
  checksum: string;
  createdById: string | null;
};

export type VersionPlan =
  | { kind: 'same' }
  | { kind: 'keep-human' }
  | { kind: 'insert'; version: number; checksum: string };

export type ScenarioSyncStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Сравнение только с последней версией: откат yaml к старому графу тоже новая версия.
 * Хвост с автором файл не вытесняет: иначе рестарт затрёт правку методиста.
 */
export function planVersion(versions: readonly KnownVersion[], graph: ScenarioGraph): VersionPlan {
  const checksum = graphChecksum(graph);
  const latest = latestVersion(versions);
  if (latest?.checksum === checksum) {
    return { kind: 'same' };
  }
  if (latest?.createdById) {
    return { kind: 'keep-human' };
  }
  return { kind: 'insert', version: (latest?.version ?? 0) + 1, checksum };
}

export function nextVersionNumber(latest: { version: number } | null): number {
  return (latest?.version ?? 0) + 1;
}

/**
 * PUT с суммой текущего yaml пишется без автора.
 * Так человек подтверждает файл, и следующее изменение yaml снова станет версией.
 */
export function fileAdoptedAuthor(
  actorId: string,
  checksum: string,
  fileChecksum: string | null,
): string | null {
  if (fileChecksum !== null && fileChecksum === checksum) {
    return null;
  }
  return actorId;
}

/**
 * PUBLISHED — только первая вставка из файла.
 * DRAFT и ARCHIVED синк не повышает: оба прячут сценарий из каталога.
 */
export function fileInsertPublishes(existing: ScenarioSyncStatus | null): boolean {
  return existing === null;
}

/** Событие публикации только у версии, которая видна в каталоге. */
export function fileVersionIsPublic(existing: ScenarioSyncStatus | null): boolean {
  return existing === null || existing === 'PUBLISHED';
}

function latestVersion(versions: readonly KnownVersion[]): KnownVersion | null {
  let latest: KnownVersion | null = null;
  for (const item of versions) {
    if (latest === null || item.version > latest.version) {
      latest = item;
    }
  }
  return latest;
}
