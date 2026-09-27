import path from 'node:path';
import { assertTrain2OutputsMatch, gameRootFromScripts, writeTrain2 } from './train2-map.ts';

const check = process.argv.includes('--check');
const extra = process.argv.slice(2).filter((argument) => argument !== '--check');
if (extra.length > 0) {
  console.error(`Unknown argument ${extra[0] ?? ''}`);
  process.exitCode = 1;
} else {
  try {
    const root = gameRootFromScripts();
    if (check) {
      assertTrain2OutputsMatch(root);
      console.log('map:check ok');
    } else {
      const built = writeTrain2(root);
      const level = path.relative(root, built.levelPath);
      const map = path.relative(root, built.mapPath);
      console.log(
        `wrote ${level} and ${map}: ${built.counts.cells} cells, ${built.counts.edges} edges, ${built.counts.seats} seats`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
