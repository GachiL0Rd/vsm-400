import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const knip = resolve('node_modules', 'knip', 'bin', 'knip.js');
const result = spawnSync(
  process.execPath,
  [knip, '--include', 'files,dependencies,unresolved,cycles'],
  {
    cwd: process.cwd(),
    env: { ...process.env, KNIP_DISABLE_RAW_TRANSFER: '1' },
    stdio: 'inherit',
  },
);

if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
