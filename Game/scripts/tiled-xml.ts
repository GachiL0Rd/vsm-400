/** Strict XML reader for the Tiled TMX/TSX subset this map actually uses. */

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlParseError';
  }
}

export interface XmlElement {
  readonly type: 'element';
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}

export interface XmlText {
  readonly type: 'text';
  readonly text: string;
}

export type XmlNode = XmlElement | XmlText;

interface Cursor {
  readonly source: string;
  index: number;
}

export function parseXml(source: string): XmlElement {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const cursor: Cursor = { source: text, index: 0 };
  skipProlog(cursor);
  const root = parseElement(cursor);
  skipWhitespace(cursor);
  if (cursor.index !== cursor.source.length) {
    throw parseError(cursor, 'Unexpected trailing content');
  }
  return root;
}

export function elementChildren(element: XmlElement, allowed?: ReadonlySet<string>): XmlElement[] {
  const children: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === 'text') {
      if (child.text.trim() !== '') {
        throw new XmlParseError(`Unexpected text in <${element.name}>`);
      }
      continue;
    }
    if (allowed !== undefined && !allowed.has(child.name)) {
      throw new XmlParseError(`Unexpected <${child.name}> in <${element.name}>`);
    }
    children.push(child);
  }
  return children;
}

export function textContent(element: XmlElement): string {
  let text = '';
  for (const child of element.children) {
    if (child.type === 'element') {
      throw new XmlParseError(`Expected text in <${element.name}>, found <${child.name}>`);
    }
    text += child.text;
  }
  return text;
}

export function requiredAttribute(element: XmlElement, name: string): string {
  const value = element.attributes[name];
  if (value === undefined) {
    throw new XmlParseError(`<${element.name}> is missing attribute ${name}`);
  }
  return value;
}

function parseElement(cursor: Cursor): XmlElement {
  expect(cursor, '<');
  const name = readName(cursor);
  const attributes = readAttributes(cursor);
  skipWhitespace(cursor);
  if (consume(cursor, '/>')) {
    return { type: 'element', name, attributes, children: [] };
  }
  expect(cursor, '>');
  const children: XmlNode[] = [];
  while (cursor.index < cursor.source.length) {
    if (startsWith(cursor, '</')) {
      expect(cursor, '</');
      const close = readName(cursor);
      if (close !== name) {
        throw parseError(cursor, `Mismatched </${close}> for <${name}>`);
      }
      skipWhitespace(cursor);
      expect(cursor, '>');
      return { type: 'element', name, attributes, children };
    }
    if (startsWith(cursor, '<')) {
      const child = parseMarkup(cursor);
      if (child !== null) children.push(child);
      continue;
    }
    children.push({ type: 'text', text: readText(cursor) });
  }
  throw parseError(cursor, `Unclosed <${name}>`);
}

function parseMarkup(cursor: Cursor): XmlElement | null {
  if (startsWith(cursor, '<!--')) {
    skipComment(cursor);
    return null;
  }
  if (startsWith(cursor, '<?')) {
    skipUntil(cursor, '?>');
    return null;
  }
  if (startsWith(cursor, '<!')) {
    throw parseError(cursor, 'Unsupported declaration');
  }
  return parseElement(cursor);
}

function readAttributes(cursor: Cursor): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {};
  while (cursor.index < cursor.source.length) {
    skipWhitespace(cursor);
    if (startsWith(cursor, '>') || startsWith(cursor, '/>')) return attributes;
    const name = readName(cursor);
    skipWhitespace(cursor);
    expect(cursor, '=');
    skipWhitespace(cursor);
    expect(cursor, '"');
    const value = readQuoted(cursor);
    if (Object.hasOwn(attributes, name)) {
      throw parseError(cursor, `Duplicate attribute ${name}`);
    }
    attributes[name] = value;
  }
  throw parseError(cursor, 'Unterminated start tag');
}

function readQuoted(cursor: Cursor): string {
  let value = '';
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char === undefined) break;
    if (char === '"') {
      cursor.index += 1;
      return value;
    }
    if (char === '<') throw parseError(cursor, 'Raw "<" in attribute');
    if (char === '&') {
      value += readEntity(cursor);
      continue;
    }
    value += char;
    cursor.index += 1;
  }
  throw parseError(cursor, 'Unterminated attribute');
}

function readText(cursor: Cursor): string {
  let value = '';
  while (cursor.index < cursor.source.length && !startsWith(cursor, '<')) {
    if (startsWith(cursor, '&')) {
      value += readEntity(cursor);
      continue;
    }
    value += cursor.source[cursor.index];
    cursor.index += 1;
  }
  return value;
}

function readEntity(cursor: Cursor): string {
  const start = cursor.index;
  expect(cursor, '&');
  const end = cursor.source.indexOf(';', cursor.index);
  if (end === -1) throw parseError(cursor, 'Unterminated entity');
  const body = cursor.source.slice(cursor.index, end);
  cursor.index = end + 1;
  const decoded = decodeEntity(body);
  if (decoded === null) {
    throw new XmlParseError(`Unknown entity &${body}; at ${start}`);
  }
  return decoded;
}

function decodeEntity(body: string): string | null {
  switch (body) {
    case 'amp':
      return '&';
    case 'lt':
      return '<';
    case 'gt':
      return '>';
    case 'quot':
      return '"';
    case 'apos':
      return "'";
    default: {
      const numeric = /^#(\d+)$/.exec(body) ?? /^#x([0-9a-fA-F]+)$/.exec(body);
      const digits = numeric?.[1];
      if (digits === undefined) return null;
      const code = numeric?.[0]?.startsWith('#x') ? Number.parseInt(digits, 16) : Number(digits);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
      return String.fromCodePoint(code);
    }
  }
}

function readName(cursor: Cursor): string {
  const start = cursor.index;
  const first = cursor.source[cursor.index];
  if (first === undefined || !/^[A-Za-z_]$/.test(first)) {
    throw parseError(cursor, 'Expected a name');
  }
  cursor.index += 1;
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char === undefined || !/^[A-Za-z0-9_.:-]$/.test(char)) break;
    cursor.index += 1;
  }
  return cursor.source.slice(start, cursor.index);
}

function skipProlog(cursor: Cursor): void {
  while (cursor.index < cursor.source.length) {
    skipWhitespace(cursor);
    if (!startsWith(cursor, '<')) return;
    if (startsWith(cursor, '<?')) {
      skipUntil(cursor, '?>');
      continue;
    }
    if (startsWith(cursor, '<!--')) {
      skipComment(cursor);
      continue;
    }
    if (startsWith(cursor, '<!')) throw parseError(cursor, 'Unsupported declaration');
    return;
  }
}

function skipComment(cursor: Cursor): void {
  expect(cursor, '<!--');
  skipUntil(cursor, '-->');
}

function skipUntil(cursor: Cursor, marker: string): void {
  const found = cursor.source.indexOf(marker, cursor.index);
  if (found === -1) throw parseError(cursor, `Missing ${marker}`);
  cursor.index = found + marker.length;
}

function skipWhitespace(cursor: Cursor): void {
  while (cursor.index < cursor.source.length) {
    const char = cursor.source[cursor.index];
    if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') return;
    cursor.index += 1;
  }
}

function startsWith(cursor: Cursor, marker: string): boolean {
  return cursor.source.startsWith(marker, cursor.index);
}

function consume(cursor: Cursor, marker: string): boolean {
  if (!startsWith(cursor, marker)) return false;
  cursor.index += marker.length;
  return true;
}

function expect(cursor: Cursor, marker: string): void {
  if (!consume(cursor, marker)) throw parseError(cursor, `Expected ${marker}`);
}

function parseError(cursor: Cursor, message: string): XmlParseError {
  return new XmlParseError(`${message} at ${cursor.index}`);
}
