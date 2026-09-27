import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const allowed = /^(zod|node:crypto|\.\.?\/)/;

describe('engine boundary', () => {
  it('импортирует только zod, node:crypto и соседние файлы', () => {
    const dir = join(process.cwd(), 'src/engine');
    const files = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8');
      const specifiers = [
        ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
        ...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
        ...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g),
      ];
      for (const match of specifiers) {
        const specifier = match[1] ?? '';
        expect(specifier, `${name} → ${specifier}`).toMatch(allowed);
      }
    }
  });
});
