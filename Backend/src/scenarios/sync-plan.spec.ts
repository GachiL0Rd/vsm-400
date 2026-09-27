import { describe, expect, it } from 'vitest';
import { graphChecksum } from './checksum';
import { loadScenarioGraphs } from './load-content';
import {
  fileAdoptedAuthor,
  fileInsertPublishes,
  fileVersionIsPublic,
  planVersion,
} from './sync-plan';

const graph = loadScenarioGraphs()[0];
if (!graph) {
  throw new Error('нет сценария в content');
}
const fileChecksum = graphChecksum(graph);
const edited = { ...graph, title: `${graph.title} правка` };
const editedChecksum = graphChecksum(edited);

describe('план синка сценария', () => {
  it('сумма последней версии не создаёт новую', () => {
    expect(planVersion([{ version: 4, checksum: fileChecksum, createdById: null }], graph)).toEqual(
      { kind: 'same' },
    );
  });

  it('откат yaml к старой версии пишет новую', () => {
    expect(
      planVersion(
        [
          { version: 1, checksum: fileChecksum, createdById: null },
          { version: 2, checksum: editedChecksum, createdById: null },
        ],
        graph,
      ),
    ).toEqual({ kind: 'insert', version: 3, checksum: fileChecksum });
  });

  it('человеческий хвост не вытесняется, даже если файл равен старой версии', () => {
    expect(
      planVersion(
        [
          { version: 1, checksum: fileChecksum, createdById: null },
          { version: 2, checksum: editedChecksum, createdById: 'methodist' },
        ],
        graph,
      ),
    ).toEqual({ kind: 'keep-human' });
  });

  it('человеческий хвост с новой суммой файла не вытесняется', () => {
    expect(
      planVersion([{ version: 3, checksum: editedChecksum, createdById: 'methodist' }], graph),
    ).toEqual({ kind: 'keep-human' });
    expect(
      planVersion(
        [
          { version: 4, checksum: editedChecksum, createdById: 'methodist' },
          { version: 2, checksum: 'старая-сумма', createdById: null },
        ],
        graph,
      ),
    ).toEqual({ kind: 'keep-human' });
  });

  it('файловый хвост с другой суммой становится следующей версией', () => {
    expect(planVersion([], graph)).toEqual({
      kind: 'insert',
      version: 1,
      checksum: fileChecksum,
    });
    expect(
      planVersion(
        [
          { version: 1, checksum: 'a', createdById: null },
          { version: 4, checksum: 'b', createdById: null },
        ],
        edited,
      ),
    ).toEqual({ kind: 'insert', version: 5, checksum: editedChecksum });
  });

  it('PUBLISHED только у новой строки, архив и черновик не публикуются', () => {
    expect(fileInsertPublishes(null)).toBe(true);
    expect(fileInsertPublishes('PUBLISHED')).toBe(false);
    expect(fileInsertPublishes('DRAFT')).toBe(false);
    expect(fileInsertPublishes('ARCHIVED')).toBe(false);
    expect(fileVersionIsPublic(null)).toBe(true);
    expect(fileVersionIsPublic('PUBLISHED')).toBe(true);
    expect(fileVersionIsPublic('DRAFT')).toBe(false);
    expect(fileVersionIsPublic('ARCHIVED')).toBe(false);
  });

  it('сумма файла снимает автора версии', () => {
    expect(fileAdoptedAuthor('methodist', fileChecksum, fileChecksum)).toBeNull();
    expect(fileAdoptedAuthor('methodist', editedChecksum, fileChecksum)).toBe('methodist');
    expect(fileAdoptedAuthor('methodist', fileChecksum, null)).toBe('methodist');
  });
});
