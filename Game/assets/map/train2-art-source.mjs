// Original 64 x 64 concept art for the long VSM carriage. The two SVG atlases
// are source artwork; Tiled uses rasterized PNG copies of these sheets.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const s = 64;
const cols = 8;
const cream = '#c6bbb0';
const ivory = '#e3d5c2';
const warm = '#f4c983';
const oak = '#856854';
const graphite = '#26313d';
const navy = '#15212d';
const blue = '#2478b9';
const red = '#a72f38';

const rect = (x, y, w, h, fill, opacity = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" opacity="${opacity}"/>`;
const path = (d, fill, stroke = 'none', strokeWidth = 1) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
const circle = (x, y, radius, fill, stroke = 'none', strokeWidth = 1) =>
  `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
const text = (x, y, value, size = 8, color = ivory) =>
  `<text x="${x}" y="${y}" fill="${color}" font-family="Arial,sans-serif" font-size="${size}" font-weight="700" text-anchor="middle">${value}</text>`;

function speckle(seed, color, count = 20, opacity = 0.2) {
  let state = seed * 982451653;
  let output = '';
  for (let i = 0; i < count; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = 2 + (state % 60);
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const y = 2 + (state % 60);
    output += rect(x, y, i % 5 === 0 ? 3 : 1, i % 7 === 0 ? 2 : 1, color, opacity);
  }
  return output;
}

function wall() {
  return (
    rect(0, 0, 64, 64, '#b7ada3') +
    rect(0, 0, 64, 5, ivory) +
    rect(0, 6, 64, 44, cream) +
    rect(0, 52, 64, 3, oak) +
    rect(0, 56, 64, 8, '#6b5d59') +
    rect(4, 9, 1, 37, '#958f88') +
    rect(59, 9, 1, 37, '#eee3d0') +
    speckle(2, '#5f5b5f', 18, 0.12)
  );
}

function glass(seed) {
  return (
    wall() +
    rect(6, 5, 52, 54, '#514847') +
    rect(9, 8, 46, 48, '#1c3443') +
    rect(12, 11, 40, 42, '#46616d') +
    path('M12 41 L37 11 L48 11 L23 53 Z', '#a5a99d', 'none') +
    path('M38 53 L53 34 L53 40 L43 53 Z', '#d7c9b2', 'none') +
    rect(5, 5, 54, 3, '#5f4e4b') +
    speckle(seed, '#f7d194', 12, 0.19)
  );
}

function ceiling() {
  return (
    rect(0, 0, 64, 64, '#514a49') +
    rect(0, 0, 64, 9, '#312e33') +
    rect(0, 10, 64, 34, '#aa9b91') +
    rect(0, 45, 64, 5, '#6f6766') +
    rect(0, 53, 64, 8, '#d1bda4') +
    speckle(1, '#5d514d', 22, 0.12)
  );
}

function seatTop(color, highlight) {
  return (
    path('M10 64 L10 23 Q10 7 24 4 L43 4 Q55 7 55 23 L55 64 Z', '#333037', '#15171e', 3) +
    path(`M15 60 L15 22 Q16 12 27 10 L41 10 Q50 13 50 23 L50 60 Z`, color, highlight, 2) +
    path('M18 21 Q30 17 47 21 L45 29 Q29 25 20 30 Z', highlight) +
    path('M18 44 Q31 36 48 44 L48 57 L18 57 Z', color, '#494048', 1) +
    rect(31, 31, 2, 28, '#4c474b') +
    speckle(16, highlight, 14, 0.15)
  );
}

function seatBase(color, highlight) {
  return (
    rect(10, 0, 46, 12, '#39343a') +
    path(`M10 10 L55 10 L54 35 Q48 45 38 46 L19 46 Q11 44 10 35 Z`, color, '#343038', 3) +
    path('M15 14 L51 14 L47 32 Q44 37 37 38 L20 38 Q15 35 15 30 Z', highlight) +
    rect(5, 16, 8, 23, '#3c3437') +
    rect(53, 16, 8, 23, '#3c3437') +
    rect(10, 43, 48, 5, '#69554e') +
    path('M27 48 L40 48 L37 64 L30 64 Z', graphite) +
    rect(29, 53, 9, 2, blue)
  );
}

function sheet(tiles, defs) {
  const artwork = tiles
    .map((tile, i) => `<g transform="translate(${(i % cols) * s} ${Math.floor(i / cols) * s})"><g clip-path="url(#cell)">${tile}</g></g>`)
    .join('\n');
  const height = Math.ceil(tiles.length / cols) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="${height}" viewBox="0 0 512 ${height}" shape-rendering="crispEdges"><defs><clipPath id="cell"><rect width="64" height="64"/></clipPath>${defs}</defs>${artwork}</svg>`;
}

const interior = Array.from({ length: 48 }, () => '');
interior[0] = rect(0, 0, 64, 64, '#0d1119');
interior[1] = ceiling();
interior[2] = ceiling() + rect(5, 47, 54, 4, warm) + rect(9, 51, 46, 3, ivory) + rect(0, 55, 64, 8, '#d4bba1') + rect(0, 18, 64, 25, 'url(#warmGlow)', 0.45);
interior[3] = ceiling() + rect(0, 28, 64, 11, '#77695e') + rect(4, 32, 56, 6, oak) + rect(7, 39, 50, 3, ivory);
interior[4] = ceiling() + rect(17, 16, 30, 22, '#817a73') + [22, 30, 38].map((x) => circle(x, 27, 3, '#514c4d')).join('');
interior[5] = wall();
interior[6] = wall() + rect(7, 5, 50, 51, '#795e52') + rect(11, 9, 42, 44, '#997762') + rect(13, 11, 38, 41, '#b28c6a') + path('M14 49 L49 13', 'none', '#d5aa79', 2);
interior[7] = glass(7);
interior[8] = glass(8) + rect(13, 34, 38, 17, '#83684c', 0.37);
interior[9] = wall() + rect(25, 0, 14, 64, '#a59b91') + rect(29, 0, 6, 64, '#e3cfb5') + rect(23, 0, 2, 64, '#665959');
interior[10] = wall() + rect(15, 16, 34, 29, '#7a7773') + rect(19, 20, 26, 21, graphite) + circle(32, 30, 5, '#53a6c4') + rect(22, 37, 20, 2, warm);
interior[11] = wall() + rect(8, 0, 48, 64, '#4c4c4d') + rect(12, 3, 40, 57, '#77716c') + rect(16, 7, 32, 44, '#263642') + rect(19, 10, 26, 32, '#43606a') + rect(8, 0, 48, 3, ivory);
interior[12] = wall() + rect(8, 0, 48, 58, '#4c4c4d') + rect(12, 0, 40, 52, '#77716c') + rect(16, 0, 32, 41, '#4b4b4c') + circle(44, 27, 3, warm) + rect(7, 57, 50, 5, oak);
interior[13] = rect(0, 0, 64, 64, '#302b2c') + rect(0, 0, 64, 4, '#625554') + [15, 31, 47].map((y) => rect(0, y, 64, 1, '#473e3d')).join('') + speckle(13, '#957a68', 36, 0.16);
interior[14] = rect(0, 0, 64, 64, '#5d4d4c') + rect(0, 0, 64, 4, '#927c6c') + rect(0, 57, 64, 4, '#312e32') + speckle(14, '#ba9e81', 35, 0.2);
interior[15] = rect(0, 0, 64, 64, '#624d46') + rect(0, 0, 64, 4, '#dbc49c') + rect(0, 5, 64, 6, '#765b50') + rect(0, 58, 64, 4, graphite);
interior[16] = seatTop('#696c70', '#9d9b91');
interior[17] = seatBase('#68686a', '#a3a096');
interior[18] = seatTop('#8a6d61', '#c39a80');
interior[19] = seatBase('#88695d', '#c19a80');
interior[20] = seatTop('#55545a', '#89817e') + rect(8, 57, 52, 7, '#211f24', 0.65);
interior[21] = seatBase('#585057', '#927f78');
interior[22] = seatTop('#746056', '#ae8b77') + rect(8, 57, 52, 7, '#211f24', 0.65);
interior[23] = seatBase('#776057', '#b08a76');
interior[24] = path('M3 22 L61 22 L58 35 L6 35 Z', '#9e7455', '#4a3b39', 3) + rect(7, 19, 50, 5, '#c3a17b') + [12, 26, 44].map((x) => path(`M${x} 26 L${x + 11} 26`, 'none', '#d5b18b', 1)).join('') + circle(35, 14, 5, '#e4dbc6') + rect(30, 8, 10, 7, '#c5a17b');
interior[25] = rect(15, 0, 7, 63, '#574b48') + rect(44, 0, 7, 63, '#574b48') + rect(5, 59, 55, 4, '#342e31') + rect(14, 3, 38, 4, '#c7a17b');
interior[26] = rect(1, 19, 62, 9, '#61534f') + rect(4, 21, 56, 4, '#baa289') + rect(3, 30, 58, 4, '#6f5c54') + [7, 27, 47].map((x) => rect(x, 35, 13, 20, '#514949')).join('');
interior[27] = path('M10 55 L13 18 L53 18 L56 55 Z', '#51494b', '#a7896c', 2) + path('M24 18 Q25 3 33 3 Q42 3 43 18', 'none', '#917667', 3) + rect(18, 24, 34, 5, '#85746a') + rect(29, 35, 8, 9, '#c3aa85');
interior[28] = wall() + rect(7, 5, 50, 52, '#68615b') + rect(11, 9, 42, 44, '#91847a') + [14, 28, 42].map((y) => rect(11, y, 42, 3, '#453c3d')).join('') + circle(30, 35, 6, '#d2c2a9');
interior[29] = wall() + rect(7, 0, 50, 57, '#5a5351') + rect(11, 4, 42, 49, '#817873') + rect(14, 19, 36, 8, '#423c3f') + rect(16, 22, 33, 3, warm) + rect(16, 42, 33, 3, '#443e41');
interior[30] = rect(27, 5, 10, 8, '#b8c1ba') + rect(21, 14, 23, 37, '#c43d37') + rect(24, 17, 17, 29, '#e15748') + rect(25, 22, 16, 11, '#f8e5c2') + text(33, 31, 'F', 8, red) + rect(28, 0, 7, 6, '#505755') + path('M27 9 Q15 2 11 12', 'none', '#6b6964', 2);
interior[31] = rect(4, 14, 56, 36, '#4c4a48') + rect(8, 18, 48, 28, '#e3d3bb') + text(32, 37, 'WC', 17, graphite);
interior[32] = wall() + rect(10, 7, 44, 49, '#978e83') + rect(14, 11, 36, 40, '#ded3c3') + rect(17, 13, 30, 30, '#bbb8b0');
interior[33] = rect(0, 0, 64, 64, '#aaa398') + rect(0, 0, 64, 3, ivory) + path('M18 17 Q32 9 46 17 L45 43 Q32 52 19 43 Z', '#e7e2d6', '#7b7a75', 2) + circle(32, 24, 7, '#566973');
interior[34] = rect(7, 8, 50, 48, '#484949') + rect(10, 11, 44, 41, '#aaa79c') + rect(14, 14, 36, 25, '#1e3d4b') + rect(17, 17, 30, 19, '#4c8a91') + [20, 32, 44].map((x) => circle(x, 45, 2, warm)).join('');
interior[35] = wall() + rect(8, 7, 48, 50, '#3b4246') + rect(12, 11, 40, 43, '#244051') + path('M15 50 L45 12 L51 12 L21 53 Z', '#c5c0ac', 'none') + rect(9, 8, 46, 3, oak);
interior[36] = path('M4 54 L47 4 L57 4 L13 56 Z', '#dce3d6', 'none') + path('M27 58 L60 25 L60 32 L35 58 Z', '#7da8ac');
interior[37] = circle(32, 20, 28, 'url(#warmGlow)') + path('M0 0 L64 0 L50 61 L14 61 Z', '#f5d391', 'none', 0) + rect(14, 24, 36, 40, 'url(#warmGlow)', 0.3);
interior[38] = wall() + rect(30, 0, 4, 64, '#877e78') + rect(35, 0, 2, 64, ivory);
interior[39] = rect(1, 0, 62, 64, '#b9aa9a') + rect(4, 0, 56, 60, '#8b756b') + [15, 31, 47].map((x) => rect(x, 0, 2, 58, '#d3b99d')).join('');
interior[40] = glass(40) + path('M8 50 L23 29 L34 41 L44 20 L58 39 L58 57 L8 57 Z', '#687d78', 'none');
interior[41] = circle(32, 22, 7, '#e8dcca') + rect(26, 12, 12, 13, '#c5a578') + path('M37 15 Q47 11 45 20 Q42 25 37 22', 'none', '#d9c3a1', 2);
interior[42] = path('M8 19 L30 15 L55 23 L54 47 L32 43 L11 47 Z', '#e7dec6', '#817a70', 2) + path('M31 17 L32 43 M15 27 L27 25 M37 29 L48 31', 'none', '#948977', 2);
interior[43] = rect(29, 0, 6, 64, '#82756b') + rect(30, 0, 3, 64, '#e3c59e') + circle(32, 34, 6, '#cbb494');
interior[44] = rect(8, 9, 48, 47, '#8a7d75') + rect(12, 13, 40, 39, '#d8c7b2') + [19, 29, 39].map((x) => circle(x, 25, 3, '#658c9b')).join('') + text(32, 43, 'USB', 9, graphite);
interior[45] = rect(2, 23, 60, 10, '#514949') + rect(4, 21, 56, 6, '#9a8675') + rect(10, 34, 7, 29, graphite) + rect(47, 34, 7, 29, graphite);
interior[46] = wall() + rect(6, 11, 52, 39, graphite) + rect(10, 15, 44, 31, '#537281') + text(32, 36, 'ВСМ', 15, ivory) + rect(11, 40, 42, 2, warm);
interior[47] = rect(0, 0, 64, 64, '#0a1017', 0.25) + rect(0, 45, 64, 19, '#0a1017', 0.27);

const exterior = Array.from({ length: 48 }, () => '');
exterior[0] = rect(0, 0, 64, 64, '#0b1019');
exterior[1] = rect(0, 0, 64, 64, '#1d2834') + rect(0, 0, 64, 15, '#47545e') + rect(0, 18, 64, 28, '#303b47') + rect(0, 49, 64, 6, '#b4adb0') + rect(0, 56, 64, 8, navy) + speckle(1, '#cdd6d5', 25, 0.12);
exterior[2] = exterior[1] + rect(30, 0, 4, 51, '#64717b') + rect(35, 0, 2, 53, '#111b26');
exterior[3] = exterior[1] + rect(9, 6, 48, 21, '#162430') + [16, 28, 40].map((x) => rect(x, 11, 6, 10, '#5e6a70')).join('');
exterior[4] = rect(0, 0, 64, 64, '#6c7680') + rect(0, 0, 64, 5, '#b9b8b4') + rect(0, 7, 64, 24, '#737b81') + rect(0, 34, 64, 5, '#d3ccc4') + rect(0, 41, 64, 13, graphite) + rect(0, 56, 64, 8, navy) + speckle(4, ivory, 22, 0.12);
exterior[5] = exterior[4] + rect(6, 7, 52, 34, '#212b35') + rect(10, 10, 44, 26, '#3c5660') + path('M11 34 L38 10 L52 10 L25 36 Z', '#a5b4b3') + rect(0, 41, 64, 5, '#c5bbb1');
exterior[6] = exterior[4] + rect(14, 4, 36, 57, '#2a343d') + rect(18, 8, 28, 50, '#616f73') + rect(21, 10, 22, 31, '#1b3646') + rect(37, 44, 4, 11, warm);
exterior[7] = rect(0, 0, 64, 64, '#27323f') + rect(0, 0, 64, 4, '#d1cbc2') + rect(0, 8, 64, 21, '#61717a') + rect(0, 32, 64, 20, graphite) + rect(0, 54, 64, 6, '#0a121d');
exterior[8] = exterior[7] + rect(0, 18, 64, 6, blue) + rect(0, 25, 64, 3, '#4cc9f0');
exterior[9] = exterior[7] + rect(0, 18, 64, 8, red) + rect(0, 28, 64, 3, '#e9575a');
exterior[10] = rect(0, 0, 64, 64, '#0b1019') + path('M0 57 Q18 26 62 0 L64 64 L0 64 Z', '#87929a', '#d3d5cf', 2) + path('M16 49 Q38 19 64 8 L64 30 Q46 32 30 58 Z', graphite) + path('M5 60 L43 35 L58 48 L58 64 Z', red);
exterior[11] = rect(0, 0, 64, 64, '#0b1019') + path('M0 49 Q19 15 64 1 L64 64 L0 64 Z', '#8f9ca4', '#d4d9d7', 2) + path('M12 42 Q29 17 64 9 L64 40 L26 58 Z', '#203c50') + path('M0 56 L52 37 L64 46 L64 64 L0 64 Z', red) + path('M23 39 L46 18', 'none', '#f6ece1', 4);
exterior[12] = rect(0, 0, 64, 64, '#0b1019') + path('M0 21 Q19 5 64 2 L64 64 L0 64 Z', '#707b84', '#d4d7d1', 2) + path('M0 35 Q26 21 64 30 L64 64 L0 64 Z', red) + rect(0, 55, 64, 7, '#6b202e');
exterior[13] = rect(0, 0, 64, 64, '#0e141b') + path('M0 0 Q60 8 64 57 L64 64 L0 64 Z', '#687984', '#d1d3cc', 2) + rect(0, 48, 50, 6, blue);
exterior[14] = rect(0, 0, 64, 64, '#0b1118') + rect(6, 13, 52, 20, '#1b2933') + rect(12, 18, 40, 10, '#596875') + path('M0 38 L21 38 L32 50 L43 38 L64 38', 'none', '#829096', 4) + circle(32, 50, 8, '#252b2e');
exterior[15] = rect(0, 0, 64, 64, '#0d141d') + rect(0, 0, 64, 7, '#77878b') + rect(0, 9, 64, 19, '#263845') + rect(0, 31, 64, 7, '#485761') + rect(0, 42, 64, 22, '#151d28') + speckle(15, '#bdc8c8', 25, 0.11);
exterior[16] = exterior[15] + rect(8, 12, 48, 40, '#1a2631') + rect(11, 15, 42, 30, '#41515b') + rect(14, 18, 36, 23, '#1e2c37') + circle(16, 49, 3, '#71838c') + circle(48, 49, 3, '#71838c');
exterior[17] = exterior[15] + circle(32, 41, 26, '#0b0f17', '#718087', 5) + circle(32, 41, 18, '#293642', '#141a20', 3) + circle(32, 41, 8, '#889499', '#303b40', 3);
exterior[18] = rect(0, 0, 64, 64, '#131722') + rect(0, 13, 64, 5, '#52525b') + rect(0, 22, 64, 4, '#bbb2a1') + rect(0, 34, 64, 7, '#34323a') + rect(0, 46, 64, 4, '#555963') + rect(0, 53, 64, 11, '#1b1e29') + speckle(18, '#b7a696', 22, 0.13);
exterior[19] = exterior[18] + rect(0, 20, 64, 4, '#5ed9ff') + rect(0, 25, 64, 4, blue) + rect(0, 31, 64, 6, 'url(#blueGlow)', 0.75);
exterior[20] = rect(0, 0, 64, 64, '#777774') + rect(0, 0, 64, 3, '#c8c0b0') + [14, 31, 49].map((y) => rect(0, y, 64, 2, '#50555a')).join('') + speckle(20, ivory, 38, 0.17);
exterior[21] = exterior[20] + rect(0, 0, 64, 14, '#c8b99a') + rect(0, 13, 64, 5, '#3b4047') + [0, 22, 44].map((x) => path(`M${x} 19 L${x + 15} 19 L${x} 34 Z`, '#bfb16f')).join('');
exterior[22] = rect(0, 0, 64, 64, '#0d121a') + rect(0, 0, 64, 8, '#1c252c') + rect(0, 32, 64, 6, '#52616b') + rect(0, 41, 64, 4, '#1f2d39');
exterior[23] = rect(0, 0, 64, 64, '#132634') + rect(0, 45, 64, 19, '#1d3342') + [3, 20, 40, 55].map((x) => rect(x, 28 + (x % 3) * 4, 8, 25, '#294353')).join('') + [8, 26, 44].map((x) => rect(x, 38, 2, 2, warm)).join('');
exterior[24] = path('M0 12 L64 21 M0 32 L64 42', 'none', '#778d98', 2) + circle(52, 38, 5, '#b4a482');
exterior[25] = circle(32, 30, 29, 'url(#warmGlow)') + path('M18 20 L50 20 L44 38 L17 38 Z', '#f8edd3', '#7f8990', 2) + rect(18, 39, 30, 5, '#bbbbb2');
exterior[26] = rect(0, 0, 64, 64, '#414955') + [0, 20, 40].map((x) => path(`M${x} 18 L${x + 19} 18 L${x} 38 Z`, warm)).join('') + rect(0, 40, 64, 4, '#d5b86e');
exterior[27] = exterior[4] + rect(7, 16, 50, 20, '#26333e') + [12, 22, 32, 42].map((x) => rect(x, 20, 4, 12, '#a0aaa8')).join('');
exterior[28] = rect(0, 0, 64, 64, '#303946') + rect(0, 0, 64, 5, '#d5d1c7') + rect(0, 10, 64, 13, '#678291') + rect(0, 27, 64, 6, blue) + rect(0, 35, 64, 4, '#5ed9ff') + rect(0, 43, 64, 21, '#1a2634');
exterior[29] = rect(0, 0, 64, 64, '#121c29') + path('M0 0 Q61 9 63 59 L63 64 L0 64 Z', '#606f79') + rect(0, 20, 47, 6, blue) + rect(0, 29, 38, 4, '#55b9df');
exterior[30] = exterior[15] + rect(5, 10, 54, 34, '#111a25') + [12, 23, 34, 45].map((x) => rect(x, 14, 5, 23, '#516575')).join('');
exterior[31] = exterior[4] + rect(16, 24, 31, 10, red) + rect(19, 26, 25, 5, '#fb8682');
exterior[32] = rect(0, 0, 64, 64, '#0b1019');
exterior[33] = exterior[1] + rect(0, 41, 64, 4, blue) + rect(0, 47, 64, 2, '#a8d4e0');
exterior[34] = exterior[4] + rect(8, 11, 48, 38, graphite) + rect(11, 14, 42, 32, '#556f7c') + text(32, 37, 'ВСМ', 15, ivory);
exterior[35] = rect(4, 4, 56, 56, '#162734') + rect(8, 8, 48, 48, '#406576') + path('M10 49 L46 10 L55 10 L20 56 Z', '#b7c0b8');
exterior[36] = exterior[7] + rect(12, 0, 41, 58, '#677982') + rect(16, 2, 33, 51, '#3b4b54') + rect(45, 23, 3, 16, warm);
exterior[37] = path('M4 47 L60 47 L60 54 L4 54 Z', '#a6abb0') + rect(9, 55, 46, 5, '#5e6972') + [11, 30, 49].map((x) => rect(x, 60, 5, 4, '#27323c')).join('');
exterior[38] = path('M2 10 Q30 48 62 11 M2 32 Q32 63 62 30', 'none', '#76878f', 4) + circle(32, 38, 6, '#b1aba0');
exterior[39] = rect(8, 9, 48, 42, '#18222c') + path('M10 25 L21 39 L32 24 L43 39 L54 25', 'none', '#9eaaac', 4) + rect(6, 47, 52, 6, '#4a5962');
exterior[40] = rect(3, 13, 58, 38, graphite) + rect(7, 17, 50, 30, '#4f6c7a') + text(32, 37, 'ВСМ', 15, ivory);
exterior[41] = rect(0, 22, 64, 34, 'url(#blueGlow)', 0.65);
exterior[42] = exterior[4] + rect(29, 0, 5, 64, '#374552') + rect(35, 0, 2, 64, '#c1bdb5');
exterior[43] = exterior[7] + [10, 23, 36, 49].map((x) => circle(x, 15, 2, ivory)).join('');
exterior[44] = exterior[5] + rect(0, 44, 64, 5, blue) + rect(0, 50, 64, 2, '#81c2d7');
exterior[45] = path('M0 5 L64 20 M0 15 L64 30', 'none', '#799099', 2);
exterior[46] = rect(28, 0, 9, 64, '#374550') + rect(29, 0, 3, 64, '#b4b9b8') + path('M2 20 L58 20 L55 26 L5 26 Z', '#637581');
exterior[47] = rect(0, 0, 64, 64, '#252831') + speckle(47, '#857b72', 46, 0.22);

const defs = `<radialGradient id="warmGlow"><stop stop-color="#ffe4aa" stop-opacity="0.85"/><stop offset="1" stop-color="#ffe4aa" stop-opacity="0"/></radialGradient><radialGradient id="blueGlow"><stop stop-color="#46a8eb" stop-opacity="0.75"/><stop offset="1" stop-color="#46a8eb" stop-opacity="0"/></radialGradient>`;
writeFileSync(fileURLToPath(new URL('./train2-interior.svg', import.meta.url)), sheet(interior, defs));
writeFileSync(fileURLToPath(new URL('./train2-exterior.svg', import.meta.url)), sheet(exterior, defs));
