import { readdir, readFile } from 'node:fs/promises';

const files = (await readdir('dist/client/assets')).filter((name) => name.endsWith('.js'));
if (files.length === 0) throw new Error('Production JavaScript bundle is missing.');
const bundle = (await Promise.all(files.map((name) => readFile(`dist/client/assets/${name}`, 'utf8')))).join('\n');

for (const sentinel of [
  'Тестовая смена:',
  'В вагоне слышен слабый свист.',
  'Пожар: корректная реакция',
  'Пассажир: проверка документов не завершена.',
]) {
  if (bundle.includes(sentinel)) throw new Error(`Private demo or legacy state leaked into bundle: ${sentinel}`);
}

console.log(`Production bundle inspected: ${files.length} JavaScript file(s), no demo/legacy state sentinels.`);
