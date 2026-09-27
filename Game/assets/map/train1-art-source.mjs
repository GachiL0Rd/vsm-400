// Original 64 px concept tiles for the train cutaway. Run with Node.js to
// regenerate train1-tiles.svg; rasterize that SVG to PNG before importing it
// into Tiled. The art is deliberately a replaceable concept pass.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const W = 64;
const C = 8;
const ink = '#101216';
const gold = '#a78655';
const goldLight = '#d4ab69';
const brassDark = '#54402d';
const wood = '#3b292b';
const woodLight = '#654344';
const red = '#772d3d';
const redLight = '#b04b5b';
const teal = '#29474b';
const steel = '#314146';

const r = (x, y, w, h, fill, opacity = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" opacity="${opacity}"/>`;
const path = (d, fill, stroke = 'none', sw = 1) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const circ = (x, y, rad, fill, stroke = 'none', sw = 1) =>
  `<circle cx="${x}" cy="${y}" r="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const label = (x, y, value, size = 8, color = goldLight) =>
  `<text x="${x}" y="${y}" fill="${color}" font-family="Georgia,serif" font-size="${size}" font-weight="bold" text-anchor="middle">${value}</text>`;

function flecks(seed, color, count = 32, opacity = 0.3) {
  let n = seed * 17713 + 31;
  let svg = '';
  for (let i = 0; i < count; i += 1) {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    const x = 2 + (n % 60);
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    const y = 2 + (n % 60);
    svg += r(x, y, i % 4 === 0 ? 3 : 1, 1, color, opacity);
  }
  return svg;
}

const panel = () =>
  r(0, 0, 64, 64, wood) +
  r(1, 1, 62, 62, '#342729') +
  r(4, 4, 56, 54, '#483235') +
  r(7, 7, 50, 48, '#30262a') +
  r(11, 11, 42, 40, '#423235') +
  r(2, 0, 3, 64, brassDark) +
  r(59, 0, 3, 64, brassDark) +
  r(0, 58, 64, 3, gold) +
  flecks(3, '#9d7760', 25, 0.14);

const wall = () =>
  r(0, 0, 64, 64, '#433437') +
  r(0, 0, 64, 3, gold) +
  r(0, 4, 64, 34, '#4d3b3c') +
  r(0, 37, 64, 2, brassDark) +
  r(0, 40, 64, 24, '#30282c') +
  r(0, 60, 64, 2, gold) +
  r(6, 7, 2, 27, '#77564d') +
  r(56, 7, 2, 27, '#77564d') +
  flecks(4, '#b4967a', 42, 0.12);

const metal = () =>
  r(0, 0, 64, 64, '#223038') +
  r(2, 2, 60, 60, '#2e4548') +
  r(0, 0, 64, 4, '#647273') +
  r(0, 60, 64, 4, ink) +
  r(5, 6, 54, 49, '#344b4d') +
  r(5, 35, 54, 18, '#24383b') +
  [9, 55].map((x) => [9, 52].map((y) => circ(x, y, 2, '#96a4a0')).join('')).join('') +
  flecks(9, '#b6aba0', 25, 0.15);

const rug = () =>
  r(0, 0, 64, 64, '#522430') +
  r(0, 0, 64, 4, '#963f45') +
  r(0, 60, 64, 4, '#251b22') +
  flecks(16, '#d5a875', 55, 0.34);

const seatTop = (mirror = false) => {
  const body =
    path('M7 59 L7 18 Q9 5 25 3 L45 3 Q56 6 58 20 L58 59 Z', '#3a1b27', ink, 3) +
    path('M12 54 L12 20 Q14 10 26 9 L43 9 Q52 12 53 22 L53 54 Z', red, '#c46a68', 2) +
    path('M18 50 L18 20 Q19 16 28 14 L44 14', 'none', redLight, 2) +
    r(28, 11, 3, 42, '#5d2431') +
    r(9, 56, 49, 5, gold) +
    flecks(26, '#ee9b88', 14, 0.12);
  return mirror ? `<g transform="translate(64 0) scale(-1 1)">${body}</g>` : body;
};
const seatBase = (mirror = false) => {
  const body =
    r(7, 0, 51, 10, '#3a1b27') +
    path('M10 7 L55 7 L52 32 Q48 42 38 43 L17 43 Q9 40 8 30 Z', '#692735', ink, 3) +
    path('M13 10 L52 10 L48 28 Q45 34 36 35 L18 35 Q13 32 13 28 Z', '#9d3b4b', '#c46567', 2) +
    r(11, 35, 45, 6, gold) +
    r(12, 41, 6, 20, brassDark) +
    r(48, 41, 6, 20, brassDark) +
    r(2, 11, 7, 17, woodLight) +
    r(55, 11, 7, 17, woodLight);
  return mirror ? `<g transform="translate(64 0) scale(-1 1)">${body}</g>` : body;
};

const tiles = Array.from({ length: 64 }, () => '');
tiles[0] = r(0, 0, 64, 64, '#0b0a0d');
tiles[1] = r(0, 0, 64, 64, '#121014') + r(0, 38, 64, 12, '#23181d') + r(0, 51, 64, 4, gold) + r(0, 57, 64, 7, '#2d1f23') + flecks(1, '#987566', 25, 0.1);
tiles[2] = tiles[1] + r(26, 0, 11, 58, '#33292c') + r(28, 6, 7, 46, brassDark) + r(28, 11, 7, 3, gold);
tiles[3] = wall();
tiles[4] = panel() + path('M18 18 Q32 2 46 18 L46 42 Q32 57 18 42 Z', '#39252b', gold, 2) + path('M21 32 L32 18 L43 32 L32 45 Z', '#745237', goldLight, 1);
tiles[5] = wall() + circ(32, 30, 22, 'url(#glow)') + r(27, 11, 10, 5, brassDark) + path('M25 20 Q32 10 39 20 L43 33 L21 33 Z', '#cf9d5c', '#f4ce80', 2) + r(27, 33, 10, 5, brassDark);
tiles[6] = wall() + r(15, 7, 34, 44, '#17191b') + r(18, 10, 28, 38, '#745237') + r(21, 13, 22, 32, '#242830') + circ(32, 25, 7, '#9d8068') + path('M23 39 Q32 29 41 39 Z', '#a0866e');
tiles[7] = wall() + r(7, 8, 50, 42, '#110f14') + r(11, 12, 42, 35, '#182932') + path('M14 41 L44 14 L52 14 L22 45 Z', '#6e8581', 'none') + r(7, 8, 50, 3, gold) + r(7, 47, 50, 3, gold);
tiles[8] = metal();
tiles[9] = metal() + r(11, 9, 42, 43, '#243438') + r(13, 11, 38, 39, '#3a4e50') + r(11, 10, 42, 2, gold);
tiles[10] = metal() + r(12, 5, 40, 58, '#1d2c32') + r(16, 9, 32, 48, '#4c5b59') + r(19, 12, 26, 28, '#14262e') + r(22, 15, 20, 20, '#253b40') + r(0, 0, 64, 4, gold);
tiles[11] = metal() + r(12, 0, 40, 58, '#1d2c32') + r(16, 0, 32, 51, '#4c5b59') + r(19, 1, 26, 41, '#27393c') + circ(40, 23, 3, goldLight) + r(12, 55, 40, 4, gold);
tiles[12] = r(0, 0, 64, 64, '#201b20') + r(0, 0, 12, 64, brassDark) + r(4, 0, 4, 64, gold) + r(52, 0, 12, 64, brassDark) + r(56, 0, 4, 64, gold);
tiles[13] = r(0, 0, 64, 64, '#291c24') + r(0, 0, 64, 7, gold) + path('M0 8 Q8 30 16 8 Q24 30 32 8 Q40 30 48 8 Q56 30 64 8 L64 27 Q32 45 0 27 Z', '#772534', goldLight, 1) + r(0, 37, 64, 4, brassDark);
tiles[14] = path('M6 0 L59 0 Q50 24 55 64 L0 64 Q15 30 6 0 Z', '#622632', '#ae635a', 2) + path('M15 0 Q25 28 18 64 M37 0 Q29 28 38 64', 'none', '#ab4a4d', 4);
tiles[15] = `<g transform="translate(64 0) scale(-1 1)">${tiles[14]}</g>`;
tiles[16] = rug();
tiles[17] = rug() + [12, 32, 52].map((x) => [16, 40].map((y) => path(`M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y} Z`, '#bd9460', '#6d3b37', 1)).join('')).join('');
tiles[18] = r(0, 0, 64, 64, '#766254') + [12, 27, 44, 59].map((y) => r(0, y, 64, 2, '#4e4039')).join('') + flecks(18, '#d7b88e', 34, 0.3);
tiles[19] = r(0, 0, 64, 64, '#5d2a30') + r(0, 0, 64, 5, goldLight) + r(0, 6, 64, 5, brassDark) + r(0, 55, 64, 4, '#210f18');
tiles[20] = r(0, 0, 64, 64, '#231b20') + r(0, 0, 64, 11, '#4c242b') + flecks(20, '#774a43', 20, 0.25);
tiles[21] = r(0, 0, 64, 64, '#202329') + r(0, 0, 64, 5, gold) + r(0, 7, 64, 14, '#743638') + r(0, 23, 64, 6, '#13181c') + r(0, 33, 64, 7, '#496065') + r(0, 43, 64, 4, '#0b1014') + flecks(21, '#8a7a67', 14, 0.18);
tiles[22] = r(0, 0, 64, 64, '#0c1115') + r(0, 0, 64, 9, '#24343a') + r(0, 11, 64, 21, '#161e23') + r(8, 13, 48, 16, '#243238') + r(0, 33, 64, 5, '#405258') + r(0, 53, 64, 11, '#151a1e') + flecks(22, '#758180', 21, 0.16);
tiles[23] = tiles[22] + circ(33, 40, 25, '#070a0e', '#546064', 5) + circ(33, 40, 17, '#212930', '#11171b', 3) + circ(33, 40, 6, '#697271', ink, 3);
tiles[24] = tiles[22] + r(7, 11, 50, 38, '#10151a') + r(9, 13, 46, 34, '#24323a') + r(12, 16, 40, 26, '#111a20') + r(15, 18, 34, 2, '#556568') + [13, 47].map((x) => circ(x, 49, 3, '#81908b')).join('');
tiles[25] = r(0, 0, 64, 64, '#1b1417') + r(0, 16, 64, 5, '#4a4140') + r(0, 23, 64, 3, gold) + r(0, 33, 64, 8, '#35282a') + r(0, 45, 64, 4, '#4a4140') + r(0, 51, 64, 13, '#21191b') + flecks(25, '#997561', 18, 0.2);
tiles[26] = seatTop();
tiles[27] = seatBase();
tiles[28] = seatTop(true);
tiles[29] = seatBase(true);
tiles[30] = path('M6 21 L58 21 L58 33 L6 33 Z', '#9c7850', '#442c25', 3) + r(10, 18, 44, 5, goldLight) + r(14, 34, 36, 3, '#5b4a3c') + circ(32, 17, 6, '#8eaa8d', gold, 2) + r(26, 2, 12, 10, '#584336') + circ(32, 3, 4, '#c8985b');
tiles[31] = r(11, 0, 42, 8, '#4e392e') + r(17, 8, 10, 52, brassDark) + r(37, 8, 10, 52, brassDark) + r(17, 56, 30, 4, gold) + r(7, 59, 50, 4, '#211a1a');
tiles[32] = r(26, 0, 12, 64, '#1c1a1f') + r(29, 0, 6, 64, gold) + r(25, 0, 2, 64, '#856844') + r(37, 0, 2, 64, '#856844') + circ(32, 30, 4, goldLight);
tiles[33] = r(0, 0, 64, 64, '#2d2528') + r(3, 4, 58, 54, '#433034') + r(8, 8, 48, 46, '#221d22') + r(7, 55, 50, 4, gold) + path('M14 44 L50 44 L47 19 L17 19 Z', '#39383a', '#9b784d', 2) + r(21, 23, 22, 16, '#253b40');
tiles[34] = wall() + r(7, 8, 50, 49, '#30272b') + r(11, 12, 42, 41, '#5e4c41') + r(14, 15, 36, 35, '#272c2c') + r(16, 16, 32, 4, gold) + [25, 36, 47].map((y) => r(13, y, 38, 2, '#bd9460')).join('') + circ(29, 31, 4, '#b67553') + circ(40, 41, 5, '#83978d');
tiles[35] = wall() + r(7, 0, 50, 59, '#342b2a') + r(11, 5, 42, 49, '#5e4c41') + r(13, 8, 38, 42, '#282c2d') + r(16, 13, 32, 4, gold) + r(16, 32, 32, 3, gold) + circ(42, 24, 2, goldLight);
tiles[36] = r(27, 7, 10, 5, '#d6c193') + r(19, 13, 26, 38, '#ad3f39') + r(21, 15, 22, 31, '#d65241') + r(23, 48, 18, 4, '#202328') + r(24, 20, 17, 12, '#ece1bf') + label(32, 29, 'F', 8, '#ad3f39') + path('M27 8 Q15 0 11 12', 'none', '#4a5a58', 3) + r(29, 0, 6, 8, '#535a56');
tiles[37] = r(7, 8, 50, 48, '#172124') + r(11, 11, 42, 42, '#425b5c') + r(15, 15, 34, 23, '#1a2a30') + r(18, 18, 28, 17, '#647f78') + [20, 32, 44].map((x) => circ(x, 45, 3, goldLight)).join('');
tiles[38] = r(5, 16, 54, 29, '#182b29') + r(8, 19, 48, 23, '#315951') + label(32, 36, 'EXIT', 14, '#c9d6aa') + r(1, 11, 62, 3, '#a68a5c');
tiles[39] = circ(32, 34, 29, 'url(#glow)') + path('M19 18 L45 18 L40 38 L24 38 Z', '#d59c50', goldLight, 2) + r(25, 39, 14, 5, brassDark) + r(30, 5, 4, 14, gold);
tiles[40] = r(7, 5, 50, 54, '#322328') + r(10, 8, 44, 48, gold) + r(14, 12, 36, 40, '#1c2c31') + path('M19 42 L31 19 L46 43 Z', '#957158') + circ(31, 22, 5, '#d1ac70');
tiles[41] = r(3, 9, 58, 9, '#654c3c') + r(5, 15, 54, 3, gold) + [7, 24, 42].map((x) => r(x, 19, 12, 27, '#35292d') + r(x + 2, 21, 8, 2, '#916f51')).join('');
tiles[42] = path('M11 54 L14 18 L53 18 L56 54 Z', '#45323a', '#a57b54', 3) + r(16, 25, 35, 3, gold) + path('M24 18 Q24 4 33 4 Q42 4 42 18', 'none', '#b29166', 4) + r(28, 32, 8, 9, gold);
tiles[43] = metal() + r(10, 5, 44, 54, '#37474a') + r(13, 7, 38, 49, '#59635b') + r(15, 8, 34, 4, gold) + r(18, 17, 28, 24, '#202e32') + label(32, 34, 'VS', 12, '#d9bd83');
tiles[44] = metal() + r(10, 0, 44, 57, '#37474a') + r(13, 0, 38, 51, '#59635b') + r(17, 6, 30, 35, '#27363b') + circ(40, 27, 3, goldLight) + r(12, 53, 40, 4, gold);
tiles[45] = wall() + r(9, 6, 45, 50, '#c0ad8f') + r(12, 9, 39, 44, '#766e65') + r(15, 12, 33, 28, '#d3c2a3') + r(9, 5, 45, 3, gold);
tiles[46] = r(0, 0, 64, 64, '#827b6b') + [0, 30].map((x) => [0, 31].map((y) => r(x, y, 29, 30, '#a9a18f') + r(x + 2, y + 2, 25, 26, '#b9ae99')).join('')).join('') + path('M17 19 Q32 11 47 19 L44 44 Q32 52 20 44 Z', '#eee6d3', '#5e645d', 3) + circ(32, 22, 8, '#243943');
tiles[47] = path('M2 52 L49 3 L61 3 L14 58 Z', '#b4c7b3') + path('M30 61 L64 29 L64 37 L40 61 Z', '#66868a');
tiles[48] = r(0, 0, 64, 64, '#635d53') + r(0, 0, 64, 3, '#b2a482') + [15, 32, 50].map((y) => r(0, y, 64, 2, '#454644')).join('') + flecks(48, '#cec8b2', 36, 0.2);
tiles[49] = r(0, 0, 64, 64, '#55544d') + r(0, 0, 64, 15, '#aaa281') + r(0, 10, 64, 5, '#453f3b') + [0, 20, 40].map((x) => path(`M${x} 17 L${x + 14} 17 L${x} 33 Z`, '#b09d62')).join('');
tiles[50] = r(0, 0, 64, 64, '#141519') + path('M0 0 Q48 1 62 64 L0 64 Z', '#3d3033', gold, 2) + r(0, 43, 46, 3, gold);
tiles[51] = r(0, 0, 64, 64, '#111216') + path('M0 0 L62 0 Q52 55 0 64 Z', '#28272c', gold, 2) + r(0, 3, 49, 3, gold);
tiles[52] = r(6, 13, 52, 39, '#10181d') + r(8, 15, 48, 35, '#33474a') + [14, 22, 30, 38, 46].map((x) => r(x, 20, 3, 25, '#0d181e')).join('') + r(5, 11, 54, 3, gold);
tiles[53] = r(2, 24, 60, 12, brassDark) + r(4, 21, 56, 6, gold) + path('M6 35 L21 57 L27 57 L21 36 Z', '#342323') + path('M58 35 L43 57 L37 57 L43 36 Z', '#342323');
tiles[54] = r(29, 0, 6, 19, gold) + path('M14 19 L50 19 L45 36 L19 36 Z', '#c8a05f', '#ead3a0', 2) + r(21, 36, 22, 5, brassDark) + circ(32, 41, 23, 'url(#glow)');
tiles[55] = rug() + path('M6 48 L22 44 L34 48 L46 43 L58 50', 'none', '#ac7770', 2) + r(0, 36, 64, 2, '#392026');
tiles[56] = r(0, 27, 64, 37, '#09080c', 0.38);
tiles[57] = r(5, 5, 54, 54, '#121d22') + r(9, 9, 46, 46, '#42616a') + r(13, 13, 38, 38, '#1a303b') + path('M15 45 L44 15 L50 15 L21 48 Z', '#a6baae', 'none') + r(5, 5, 54, 4, gold);
tiles[58] = r(3, 4, 58, 56, '#1c2d31') + r(7, 8, 50, 48, '#43646c') + r(10, 11, 44, 42, '#182a34') + r(3, 4, 58, 3, gold) + r(3, 57, 58, 3, gold);
tiles[59] = rug() + path('M0 32 L32 0 L64 32 L32 64 Z', 'none', '#8f5945', 2) + circ(32, 32, 5, gold);
tiles[60] = r(0, 0, 64, 64, '#141114') + path('M0 60 L0 41 Q32 3 64 41 L64 60', 'none', '#775445', 5) + path('M0 55 L0 42 Q32 8 64 42 L64 55', 'none', gold, 2);
tiles[61] = r(8, 14, 48, 32, '#243b3f') + r(11, 17, 42, 26, '#4e6161') + label(32, 37, 'WC', 20, '#e5c686');
tiles[62] = r(3, 13, 58, 37, '#352627') + r(6, 16, 52, 31, gold) + r(9, 19, 46, 25, '#563638') + label(32, 38, 'ВСМ', 16, '#f1d9a7');
tiles[63] = r(10, 9, 44, 46, '#28393b') + r(13, 12, 38, 40, '#516363') + circ(32, 32, 13, '#8d413a', gold, 3) + circ(32, 32, 5, '#eab775');

const rendered = tiles.map((content, id) => `<g transform="translate(${(id % C) * W} ${Math.floor(id / C) * W})">${content}</g>`).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" shape-rendering="crispEdges"><defs><radialGradient id="glow"><stop stop-color="#f6cf77" stop-opacity="0.55"/><stop offset="1" stop-color="#f6cf77" stop-opacity="0"/></radialGradient></defs>${rendered}</svg>`;
writeFileSync(fileURLToPath(new URL('./train1-tiles.svg', import.meta.url)), svg);
