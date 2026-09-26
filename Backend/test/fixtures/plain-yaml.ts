/**
 * В Backend нет пакета yaml, а движок файл не читает.
 * Разбор покрывает только routes.yaml: отступы, списки, скаляры, кавычки.
 */

type Yaml = null | string | number | boolean | Yaml[] | { [key: string]: Yaml };

type Line = { indent: number; raw: string };

export function parsePlainYaml(source: string): unknown {
  const lines = tokenize(source.replace(/\r\n/g, '\n'));
  if (lines.length === 0) {
    return {};
  }
  const first = lines[0];
  if (!first) {
    return {};
  }
  return parseValue(lines, { i: 0 }, first.indent);
}

function tokenize(source: string): Line[] {
  const lines: Line[] = [];
  for (const rawLine of source.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    lines.push({ indent: rawLine.length - rawLine.trimStart().length, raw: trimmed });
  }
  return lines;
}

function parseValue(lines: Line[], cursor: { i: number }, indent: number): Yaml {
  const line = lines[cursor.i];
  if (!line || line.indent !== indent) {
    return {};
  }
  if (line.raw.startsWith('-')) {
    return parseList(lines, cursor, indent);
  }
  return parseMap(lines, cursor, indent);
}

function parseMap(lines: Line[], cursor: { i: number }, indent: number): Record<string, Yaml> {
  const obj: Record<string, Yaml> = {};
  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (!line || line.indent !== indent || line.raw.startsWith('-')) {
      break;
    }
    cursor.i += 1;
    writeKey(obj, line.raw, lines, cursor, indent);
  }
  return obj;
}

function parseList(lines: Line[], cursor: { i: number }, indent: number): Yaml[] {
  const items: Yaml[] = [];
  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (!line || line.indent !== indent || !line.raw.startsWith('-')) {
      break;
    }
    items.push(parseListItem(lines, cursor, indent));
  }
  return items;
}

function parseListItem(lines: Line[], cursor: { i: number }, indent: number): Yaml {
  const line = lines[cursor.i];
  if (!line) {
    return null;
  }
  const body = line.raw.slice(1).trim();
  cursor.i += 1;
  if (body === '') {
    return parseChild(lines, cursor, indent);
  }
  if (!isKeyed(body)) {
    return parseScalar(body);
  }
  const item: Record<string, Yaml> = {};
  writeKey(item, body, lines, cursor, indent);
  while (cursor.i < lines.length) {
    const next = lines[cursor.i];
    if (!next || next.indent <= indent || next.raw.startsWith('-')) {
      break;
    }
    const keyIndent = next.indent;
    const text = next.raw;
    cursor.i += 1;
    writeKey(item, text, lines, cursor, keyIndent);
  }
  return item;
}

function writeKey(
  target: Record<string, Yaml>,
  text: string,
  lines: Line[],
  cursor: { i: number },
  parentIndent: number,
): void {
  const colon = text.indexOf(':');
  const key = text.slice(0, colon).trim();
  const value = text.slice(colon + 1).trim();
  if (value !== '') {
    target[key] = parseScalar(value);
    return;
  }
  target[key] = parseChild(lines, cursor, parentIndent);
}

function parseChild(lines: Line[], cursor: { i: number }, parentIndent: number): Yaml {
  const next = lines[cursor.i];
  if (!next || next.indent <= parentIndent) {
    return {};
  }
  return parseValue(lines, cursor, next.indent);
}

function isKeyed(body: string): boolean {
  if (body.startsWith('"') || body.startsWith("'")) {
    return false;
  }
  return body.includes(':');
}

function parseScalar(raw: string): Yaml {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}
