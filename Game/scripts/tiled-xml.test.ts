import { describe, expect, it } from 'vitest';
import {
  elementChildren,
  parseXml,
  requiredAttribute,
  textContent,
  XmlParseError,
} from './tiled-xml.ts';

describe('tiled xml subset', () => {
  it('reads attributes, nested elements, self-closing tags, and csv text', () => {
    const root = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
      <!-- platform chunk -->
      <map width="2">
        <tileset firstgid="1" source="interior.tsx"/>
        <data encoding="csv">
          <chunk x="-16" y="0" width="2" height="1">0,49</chunk>
        </data>
      </map>`);

    expect(root.name).toBe('map');
    expect(requiredAttribute(root, 'width')).toBe('2');
    const children = elementChildren(root);
    expect(children.map((child) => child.name)).toEqual(['tileset', 'data']);
    const tileset = children[0];
    if (tileset === undefined) throw new Error('missing tileset');
    expect(tileset.attributes).toEqual({ firstgid: '1', source: 'interior.tsx' });
    expect(tileset.children).toEqual([]);
    const data = children[1];
    if (data === undefined) throw new Error('missing data');
    const chunk = elementChildren(data, new Set(['chunk']))[0];
    if (chunk === undefined) throw new Error('missing chunk');
    expect(textContent(chunk).trim()).toBe('0,49');
  });

  it('decodes the five predefined entities and numeric character references', () => {
    const root = parseXml('<note text="a&amp;b&lt;c&gt;d&quot;e&apos;f&#32;&#x21;"/>');
    expect(root.attributes.text).toBe('a&b<c>d"e\'f !');
  });

  it('rejects malformed markup instead of guessing', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a b=c></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a b="1" b="2"/>')).toThrow(XmlParseError);
    expect(() => parseXml('<a>&nope;</a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a></a><b/>')).toThrow(XmlParseError);
    expect(() => parseXml('<!DOCTYPE a><a/>')).toThrow(XmlParseError);
  });
});
