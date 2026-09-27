// Generates the editable Tiled floor plan and its four original SVG image layers.
// Coordinates are measured in pixels at 1 px = 5 mm. One car module is 24 m.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('./', import.meta.url);
const px = (mm) => mm / 5;
const moduleWidth = 4800;
const imageHeight = 1024;
const bodyTop = 166;
const bodyBottom = 846;
const interiorTop = 190;
const interiorBottom = 822;

const cars = [
  {
    id: 'first', number: '01', title: 'ПЕРВЫЙ КЛАСС', layout: '2 + 1',
    seatWidthMm: 525, aisleWidthMm: 650, pitchMm: 1200,
    topCount: 2, bottomCount: 1, rows: 9, rowStart: 1950,
    seatColor: '#d5c2a5', seatLight: '#f3e5ca', accent: '#c3a87d',
    description: 'Головной вагон · кабина машиниста · зона обслуживания',
    areas: [
      ['Кабина машиниста', 'cockpit', 670, 255, 420, 500],
      ['Служебная зона', 'service', 1120, 218, 580, 220],
      ['Санузел', 'wc', 1135, 605, 260, 198],
      ['Багаж', 'luggage', 1415, 605, 285, 198],
      ['Задний тамбур', 'vestibule', 4170, 220, 360, 580],
    ],
  },
  {
    id: 'business', number: '02', title: 'БИЗНЕС КЛАСС', layout: '2 + 2',
    seatWidthMm: 480, aisleWidthMm: 520, pitchMm: 980,
    topCount: 2, bottomCount: 2, rows: 18, rowStart: 730,
    seatColor: '#aaa194', seatLight: '#e0d5c4', accent: '#9bb7bd',
    description: 'Два кресла с каждой стороны · служебные блоки у тамбуров',
    areas: [
      ['Передний тамбур', 'vestibule', 160, 455, 370, 104],
      ['Санузел', 'wc', 175, 220, 280, 205],
      ['Багаж', 'luggage', 175, 590, 280, 205],
      ['Санузел', 'wc', 4275, 220, 255, 205],
      ['Сервис', 'service', 4275, 590, 255, 205],
      ['Задний тамбур', 'vestibule', 4250, 455, 280, 104],
    ],
  },
  {
    id: 'comfort', number: '03', title: 'КОМФОРТ КЛАСС', layout: '2 + 2',
    seatWidthMm: 480, aisleWidthMm: 520, pitchMm: 930,
    topCount: 2, bottomCount: 2, rows: 14, rowStart: 1720,
    rowXs: [650, 836, 1022, 1208, 1394, 1580, 2670, 2856, 3042, 3228, 3414, 3600, 3786, 3972],
    seatColor: '#778d9d', seatLight: '#b9cbd2', accent: '#71b8c2',
    description: 'Игровая комната · семейная зона · места 2 + 2',
    areas: [
      ['Передний тамбур', 'vestibule', 160, 455, 330, 104],
      ['Санузел', 'wc', 165, 220, 295, 205],
      ['Доступный санузел', 'accessible-wc', 165, 585, 410, 215],
      ['Игровая комната', 'playroom', 1930, 225, 620, 215],
      ['Семейная зона', 'family', 1930, 570, 620, 230],
      ['Задний тамбур', 'vestibule', 4350, 455, 190, 104],
    ],
  },
  {
    id: 'standard', number: '04', title: 'СТАНДАРТ КЛАСС', layout: '3 + 2',
    seatWidthMm: 480, aisleWidthMm: 520, pitchMm: 930,
    topCount: 3, bottomCount: 2, rows: 15, rowStart: 1330,
    seatColor: '#a56f65', seatLight: '#d49c83', accent: '#cc8e79',
    description: 'Три кресла + проход + два кресла · бистро в этом вагоне',
    areas: [
      ['Передний тамбур', 'vestibule', 160, 502, 340, 104],
      ['Санузел', 'wc', 165, 220, 300, 225],
      ['Доступный санузел', 'accessible-wc', 165, 625, 390, 175],
      ['Бистро', 'bistro', 610, 215, 625, 270],
      ['Кухня и хранение', 'galley', 610, 625, 625, 175],
      ['Задний тамбур', 'vestibule', 4290, 502, 245, 104],
    ],
  },
];

const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rect = (x, y, width, height, fill, extra = '') => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke, width = 2, extra = '') => `<path d="M${x1} ${y1} L${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const label = (x, y, content, size, fill = '#e6ddcf', extra = '') => `<text x="${x}" y="${y}" fill="${fill}" font-family="Arial,DejaVu Sans,sans-serif" font-size="${size}" font-weight="700" ${extra}>${esc(content)}</text>`;

function seatPositions(car) {
  const seatWidth = px(car.seatWidthMm);
  const aisleWidth = px(car.aisleWidthMm);
  const groupWidth = (car.topCount + car.bottomCount) * seatWidth + aisleWidth;
  const topY = interiorTop + (interiorBottom - interiorTop - groupWidth) / 2;
  const aisleY = topY + car.topCount * seatWidth;
  const seatDepth = Math.round(px(car.pitchMm) * 0.68);
  const positions = [];
  for (let row = 0; row < car.rows; row += 1) {
    const x = car.rowXs?.[row] ?? car.rowStart + row * px(car.pitchMm);
    for (let index = 0; index < car.topCount + car.bottomCount; index += 1) {
      const topSide = index < car.topCount;
      const localIndex = topSide ? index : index - car.topCount;
      const y = Math.round((topSide ? topY : aisleY + aisleWidth) + localIndex * seatWidth + 4);
      positions.push({
        x: Math.round(x), y, width: seatDepth, height: Math.round(seatWidth - 8),
        row: row + 1, letter: 'ABCDE'[index], side: topSide ? 'upper' : 'lower',
      });
    }
  }
  return { positions, aisleY, aisleWidth, topY };
}

function seatSvg(seat, car) {
  const { x, y, width: w, height: h } = seat;
  return `<g>
    ${rect(x, y, w, h, '#29353c', 'rx="13" stroke="#13202b" stroke-width="4"')}
    ${rect(x + 8, y + 7, w - 18, h - 14, car.seatColor, 'rx="10"')}
    ${rect(x + 14, y + 12, w - 30, 13, car.seatLight, 'rx="6" opacity="0.75"')}
    ${rect(x + 7, y + 5, 11, h - 10, '#273440', 'rx="5"')}
    ${rect(x + w - 25, y + 5, 16, h - 10, car.seatLight, 'rx="6" opacity="0.85"')}
    ${label(x + w / 2, y + h / 2 + 7, `${seat.row}${seat.letter}`, 18, '#20303a', 'text-anchor="middle"')}
  </g>`;
}

function roomSvg([name, kind, x, y, w, h], car) {
  if (kind === 'vestibule') {
    return `<g>${rect(x, y, w, h, '#5c6870', 'rx="12" stroke="#a9b9bc" stroke-width="5"')}
      ${line(x + 16, y + h / 2, x + w - 16, y + h / 2, '#e3d5bd', 4, 'stroke-dasharray="22 14"')}
      ${label(x + w / 2, y + h / 2 - 17, 'ТАМБУР', 20, '#f0e1c9', 'text-anchor="middle"')}</g>`;
  }
  const fill = {
    cockpit: '#465866', service: '#71645c', wc: '#597583', 'accessible-wc': '#4c7c83',
    luggage: '#665b55', playroom: '#508d8c', family: '#86775f', bistro: '#895d50', galley: '#685a50',
  }[kind];
  const icon = {
    cockpit: '◉', service: '▣', wc: 'WC', 'accessible-wc': 'WC+', luggage: '▥',
    playroom: '★', family: '▤', bistro: '☕', galley: '▣',
  }[kind];
  const tile = `<g>${rect(x, y, w, h, fill, 'rx="14" stroke="#cbbca5" stroke-width="5"')}
    ${rect(x + 15, y + 15, w - 30, h - 30, 'none', 'rx="9" stroke="#e8dfcd" stroke-width="2" opacity="0.35"')}
    ${label(x + w / 2, y + h / 2 - 7, icon, 42, '#f4e9d4', 'text-anchor="middle"')}
    ${label(x + w / 2, y + h / 2 + 35, name.toUpperCase(), 21, '#f8ecdc', 'text-anchor="middle"')}
  </g>`;
  if (kind === 'playroom') {
    return tile + [0, 1, 2, 3].map((i) => `<circle cx="${x + 100 + i * (w - 200) / 3}" cy="${y + 46 + (i % 2) * 20}" r="17" fill="${['#d4aa7a', '#d88072', '#c0d28b', '#8abbd1'][i]}" opacity="0.9"/>`).join('');
  }
  if (kind === 'bistro') {
    return tile + rect(x + 65, y + h - 67, w - 130, 17, '#d6ad78', 'rx="8"') +
      [0, 1, 2, 3].map((i) => `<circle cx="${x + 115 + i * 112}" cy="${y + h - 102}" r="24" fill="#dfc4a1" stroke="#39434c" stroke-width="5"/>`).join('');
  }
  return tile;
}

function carSvg(car, index) {
  const { positions, aisleY, aisleWidth } = seatPositions(car);
  const shell = index === 0
    ? `<path d="M72 506 Q90 350 410 216 Q570 166 875 166 L4520 166 Q4630 166 4630 280 L4630 732 Q4630 846 4520 846 L875 846 Q570 846 410 796 Q90 662 72 506 Z" fill="#485864" stroke="#c8d2cd" stroke-width="15"/>`
    : rect(105, bodyTop, 4525, bodyBottom - bodyTop, '#485864', 'rx="92" stroke="#c8d2cd" stroke-width="15"');
  const cabinStart = index === 0 ? 650 : 155;
  const floor = rect(cabinStart, interiorTop, 4400 - (cabinStart - 155), interiorBottom - interiorTop, '#d7c8b3', 'rx="28" stroke="#988c81" stroke-width="8"');
  const windows = Array.from({ length: car.rows }, (_, i) => {
    const x = (car.rowXs?.[i] ?? car.rowStart + i * px(car.pitchMm)) + 8;
    return `${rect(x, 167, 132, 21, '#4d8594', 'rx="7" opacity="0.95"')}
      ${rect(x, 824, 132, 21, '#4d8594', 'rx="7" opacity="0.95"')}`;
  }).join('');
  const doorX = index === 0 ? 4370 : 285;
  const sideDoors = `<g>${rect(doorX, 164, 145, 42, '#273e4c', 'rx="9" stroke="#c0d5d6" stroke-width="5"')}
    ${rect(doorX, 806, 145, 42, '#273e4c', 'rx="9" stroke="#c0d5d6" stroke-width="5"')}
    ${line(doorX + 70, 169, doorX + 70, 201, '#8caeb6', 4)}
    ${line(doorX + 70, 811, doorX + 70, 841, '#8caeb6', 4)}</g>`;
  const aisle = `<g>${rect(index === 0 ? 1700 : 465, aisleY, index === 0 ? 2470 : 3830, aisleWidth, '#b4b8ad', 'rx="16" opacity="0.91"')}
    ${line(index === 0 ? 1700 : 500, aisleY + aisleWidth / 2, index === 0 ? 4150 : 4250, aisleY + aisleWidth / 2, '#eee4d0', 3, 'stroke-dasharray="26 22" opacity="0.85"')}</g>`;
  const seatMarks = positions.map((seat) => seatSvg(seat, car)).join('');
  const rooms = car.areas.map((area) => roomSvg(area, car)).join('');
  const dividers = `<g opacity="0.8">${line(index === 0 ? 1720 : 540, 205, index === 0 ? 1720 : 540, 809, '#65727a', 8)}
    ${line(index === 0 ? 4140 : 4220, 205, index === 0 ? 4140 : 4220, 809, '#65727a', 8)}</g>`;
  const endConnector = index < cars.length - 1
    ? `${rect(4595, 449, 205, 128, '#253945', 'rx="15" stroke="#8da5aa" stroke-width="6"')}
       ${line(4665, 460, 4665, 566, '#b1bac0', 5)}${line(4750, 460, 4750, 566, '#b1bac0', 5)}`
    : '';
  const frontConnector = index > 0
    ? `${rect(0, 449, 175, 128, '#253945', 'rx="15" stroke="#8da5aa" stroke-width="6"')}
       ${line(55, 460, 55, 566, '#b1bac0', 5)}${line(130, 460, 130, 566, '#b1bac0', 5)}`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4800" height="1024" viewBox="0 0 4800 1024">
    ${rect(0, 0, moduleWidth, imageHeight, '#0b121c')}
    ${rect(0, 995, moduleWidth, 2, '#334451')}
    ${rect(0, 1005, moduleWidth, 2, '#273641')}
    ${label(160, 77, `${car.number} / ${car.title}`, 54, '#f2e6d5')}
    ${label(162, 119, `${car.description}   ·   ${car.layout}   ·   КРЕСЛО ${car.seatWidthMm} ММ   ·   ПРОХОД ${car.aisleWidthMm} ММ   ·   ШАГ ${car.pitchMm} ММ`, 27, '#b8c6c8')}
    ${rect(120, 135, 4370, 5, car.accent, 'rx="2"')}
    ${frontConnector}${endConnector}${shell}
    ${rect(index === 0 ? 390 : 117, 193, index === 0 ? 390 : 38, 625, '#2f4250', 'rx="20" opacity="0.83"')}
    ${floor}
    ${rect(cabinStart, interiorTop, 4400 - (cabinStart - 155), 23, '#b5a58e', 'rx="10"')}
    ${rect(cabinStart, interiorBottom - 23, 4400 - (cabinStart - 155), 23, '#a99a88', 'rx="10"')}
    ${windows}${sideDoors}
    ${dividers}${aisle}${rooms}${seatMarks}
    ${rect(800, 836, 3690, 10, car.accent, 'rx="5" opacity="0.9"')}
    ${label(171, 936, `${car.number}   ${car.layout}   /   ${car.rows} РЯДОВ   /   ${positions.length} МЕСТ`, 30, '#91a6ae')}
  </svg>`;
}

function property(name, type, value) {
  return `<property name="${esc(name)}" type="${type}" value="${esc(value)}"/>`;
}
function objectXml(id, name, className, x, y, width, height, properties = {}) {
  const list = Object.entries(properties).map(([key, value]) => {
    const type = Number.isInteger(value) ? 'int' : typeof value === 'number' ? 'float' : typeof value === 'boolean' ? 'bool' : 'string';
    return property(key, type, value);
  }).join('');
  return `<object id="${id}" name="${esc(name)}" class="${esc(className)}" x="${x}" y="${y}" width="${width}" height="${height}">${list ? `<properties>${list}</properties>` : ''}</object>`;
}

const groups = {
  CarriageModules: [], WalkableZones: [], PassengerSeats: [], Compartments: [], DoorsAndCouplers: [], Collision: [],
};
let nextObjectId = 1;
function add(group, name, className, x, y, width, height, properties) {
  groups[group].push(objectXml(nextObjectId++, name, className, x, y, width, height, properties));
}
for (const [index, car] of cars.entries()) {
  const originX = index * moduleWidth;
  const { positions, aisleY, aisleWidth } = seatPositions(car);
  add('CarriageModules', car.title, 'Carriage', originX + (index === 0 ? 72 : 105), bodyTop,
    index === 0 ? 4558 : 4525, bodyBottom - bodyTop, {
      carriageId: car.id, carriageNumber: index + 1, seatLayout: car.layout,
      seatWidthMm: car.seatWidthMm, aisleWidthMm: car.aisleWidthMm,
      rowPitchMm: car.pitchMm, rowCount: car.rows, seatCount: positions.length,
      moduleLengthMm: 24000, sourceDiagram: 'photo_2026-09-20_15-09-56.jpg',
    });
  add('WalkableZones', `${car.id}-aisle`, 'Aisle', originX + (index === 0 ? 1700 : 465),
    aisleY, index === 0 ? 2470 : 3830, aisleWidth, { carriageId: car.id, widthMm: car.aisleWidthMm });
  add('WalkableZones', `${car.id}-front-connection`, 'Connection', originX + (index === 0 ? 1080 : 160),
    460, index === 0 ? 630 : 350, 107, { carriageId: car.id });
  add('WalkableZones', `${car.id}-rear-connection`, 'Connection', originX + 4170,
    460, 425, 107, { carriageId: car.id });
  if (index < cars.length - 1) {
    add('WalkableZones', `${car.id}-gangway`, 'Gangway', originX + 4595,
      466, 365, 90, { carriageId: car.id, connectsTo: cars[index + 1].id });
  }
  for (const [name, kind, x, y, w, h] of car.areas) {
    add('Compartments', `${car.id}-${kind}`, 'Compartment', originX + x, y, w, h,
      { carriageId: car.id, kind, label: name });
  }
  for (const seat of positions) {
    const name = `${car.number}-${String(seat.row).padStart(2, '0')}${seat.letter}`;
    const x = originX + seat.x;
    add('PassengerSeats', name, 'PassengerSeat', x, seat.y, seat.width, seat.height,
      { carriageId: car.id, row: seat.row, seat: seat.letter, side: seat.side,
        seatWidthMm: car.seatWidthMm, rowPitchMm: car.pitchMm });
    add('Collision', name, 'SeatCollision', x, seat.y, seat.width, seat.height, { carriageId: car.id });
  }
  if (index > 0) add('DoorsAndCouplers', `${car.id}-front-coupler`, 'Coupler', originX, 449, 175, 128, { carriageId: car.id });
  if (index < cars.length - 1) add('DoorsAndCouplers', `${car.id}-rear-coupler`, 'Coupler', originX + 4595, 449, 205, 128, { carriageId: car.id });
  const shellStart = index === 0 ? 650 : 105;
  const doorX = index === 0 ? 4370 : 285;
  for (const [side, y] of [['upper', bodyTop], ['lower', 822]]) {
    add('Collision', `${car.id}-${side}-wall-before-door`, 'OuterWall',
      originX + shellStart, y, doorX - shellStart, 24, { carriageId: car.id });
    add('Collision', `${car.id}-${side}-wall-after-door`, 'OuterWall',
      originX + doorX + 145, y, 4630 - doorX - 145, 24, { carriageId: car.id });
  }
  add('DoorsAndCouplers', `${car.id}-upper-door`, 'Door', originX + (index === 0 ? 4350 : 280), 166, 150, 24, { carriageId: car.id });
  add('DoorsAndCouplers', `${car.id}-lower-door`, 'Door', originX + (index === 0 ? 4350 : 280), 822, 150, 24, { carriageId: car.id });
}

const imageLayers = cars.map((car, index) =>
  `<imagelayer id="${index + 1}" name="${car.number} ${esc(car.title)}" offsetx="${index * moduleWidth}" offsety="0">
    <image source="train2-${car.id}.svg" width="4800" height="1024"/>
   </imagelayer>`).join('\n');
const objectLayers = Object.entries(groups).map(([name, objects], index) =>
  `<objectgroup id="${index + 8}" name="${name}" visible="0">${objects.join('\n')}</objectgroup>`).join('\n');

const classTiles = [
  ['01', '#c3a87d'], ['02', '#9bb7bd'], ['03', '#71b8c2'], ['04', '#cc8e79'],
  ['★', '#508d8c'], ['☕', '#895d50'], ['WC+', '#4c7c83'], ['▤', '#86775f'],
];
const detailAtlas = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="64" viewBox="0 0 512 64">
  ${classTiles.map(([text, color], index) => `<g transform="translate(${index * 64} 0)">
    <rect width="64" height="64" fill="#1d2e3b"/>
    <rect x="5" y="7" width="54" height="50" rx="8" fill="${color}" stroke="#e8decf" stroke-width="3"/>
    <text x="32" y="40" text-anchor="middle" font-family="Arial,DejaVu Sans,sans-serif" font-size="${text.length > 2 ? 18 : 24}" font-weight="bold" fill="#f7efe3">${esc(text)}</text>
   </g>`).join('')}
 </svg>`;
const detailTsx = `<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.12.2" name="VSM class and service markers" tilewidth="64" tileheight="64" tilecount="8" columns="8">
 <image source="train2-service-details.svg" width="512" height="64"/>
</tileset>\n`;

const tileCells = { ElevationShell: new Map(), ElevationInterior: new Map(), ElevationDetails: new Map() };
const setTile = (layer, x, y, gid) => tileCells[layer].set(`${x},${y}`, gid);
const ext = (tileId) => 49 + tileId;
const inside = (tileId) => 1 + tileId;
const nose = (tileId) => 97 + tileId;
const marker = (tileId) => 157 + tileId;

for (const [index, car] of cars.entries()) {
  const start = index * 75;
  const left = index === 0 ? 6 : start + 2;
  const right = start + 72;
  for (let x = left; x <= right; x += 1) {
    setTile('ElevationShell', x, 18, ext(x % 13 === 0 ? 33 : 1));
    for (let y = 19; y <= 23; y += 1) setTile('ElevationShell', x, y, ext(4));
    setTile('ElevationShell', x, 24, ext(7));
    setTile('ElevationShell', x, 25, ext(index === 0 && x < 18 ? 9 : 8));
    setTile('ElevationShell', x, 26, ext(15));
    setTile('ElevationInterior', x, 19, inside(2));
    setTile('ElevationInterior', x, 20, inside(5));
    setTile('ElevationInterior', x, 21, inside(5));
    setTile('ElevationInterior', x, 22, inside(14));
    setTile('ElevationInterior', x, 23, inside(13));
    setTile('ElevationInterior', x, 24, inside(14));
  }
  const wheelColumns = [left + 9, left + 10, right - 10, right - 9];
  for (const x of wheelColumns) setTile('ElevationDetails', x, 26, ext(17));
  const plateX = index === 0 ? 15 : start + 7;
  setTile('ElevationDetails', plateX, 21, marker(index));

  const seatTopId = [22, 16, 20, 18][index];
  const seatBaseId = [23, 17, 21, 19][index];
  for (let row = 0; row < car.rows; row += 1) {
    const rowX = car.rowXs?.[row] ?? car.rowStart + row * px(car.pitchMm);
    const x = start + Math.round((rowX + 65) / 64);
    if (x >= right - 1) continue;
    setTile('ElevationDetails', x, 20, inside(7));
    setTile('ElevationDetails', x, 22, inside(seatTopId));
    setTile('ElevationDetails', x, 23, inside(seatBaseId));
    if (index === 0 && row % 3 === 1 && x + 2 < right - 2) {
      setTile('ElevationDetails', x + 2, 23, inside(24));
    }
  }

  const doorX = index === 0 ? start + 68 : start + 4;
  setTile('ElevationDetails', doorX, 20, ext(6));
  setTile('ElevationDetails', doorX, 21, inside(11));
  const wcX = index === 0 ? start + 20 : start + 4;
  setTile('ElevationDetails', wcX, 21, inside(31));
  if (index === 0) {
    setTile('ElevationDetails', start + 9, 20, ext(5));
    setTile('ElevationDetails', start + 13, 21, inside(34));
    setTile('ElevationDetails', start + 23, 21, inside(28));
  } else if (index === 1) {
    setTile('ElevationDetails', start + 68, 21, inside(31));
    setTile('ElevationDetails', start + 66, 21, inside(29));
  } else if (index === 2) {
    setTile('ElevationDetails', start + 32, 20, marker(4));
    setTile('ElevationDetails', start + 33, 21, inside(42));
    setTile('ElevationDetails', start + 36, 21, marker(7));
    setTile('ElevationDetails', start + 7, 21, marker(6));
  } else {
    setTile('ElevationDetails', start + 11, 20, marker(5));
    setTile('ElevationDetails', start + 12, 21, inside(41));
    setTile('ElevationDetails', start + 15, 23, inside(24));
    setTile('ElevationDetails', start + 7, 21, marker(6));
  }
  if (index > 0) {
    setTile('ElevationDetails', start, 25, ext(38));
    setTile('ElevationDetails', start + 1, 25, ext(38));
  }
}
for (let x = 0; x < 300; x += 1) {
  setTile('ElevationShell', x, 27, ext(18));
  setTile('ElevationShell', x, 28, ext(19));
  setTile('ElevationShell', x, 29, ext(20));
}
for (let y = 18; y < 28; y += 1) {
  for (let x = 0; x < 6; x += 1) setTile('ElevationDetails', x, y, nose((y - 18) * 6 + x));
}

function tileLayer(name, id, cells) {
  const chunks = [];
  for (let chunkY = 16; chunkY <= 16; chunkY += 16) {
    for (let chunkX = 0; chunkX < 304; chunkX += 16) {
      const rows = Array.from({ length: 16 }, (_, localY) =>
        Array.from({ length: 16 }, (_, localX) => cells.get(`${chunkX + localX},${chunkY + localY}`) ?? 0));
      if (rows.every((row) => row.every((gid) => gid === 0))) continue;
      chunks.push(`<chunk x="${chunkX}" y="${chunkY}" width="16" height="16">\n${rows.map((row) => row.join(',')).join(',\n')}\n</chunk>`);
    }
  }
  return `<layer id="${id}" name="${name}" width="300" height="32"><data encoding="csv">${chunks.join('\n')}</data></layer>`;
}
const elevationLayers = Object.entries(tileCells).map(([name, cells], index) => tileLayer(name, index + 5, cells)).join('\n');
const map = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.12.2" orientation="orthogonal" renderorder="right-down" width="300" height="32" tilewidth="64" tileheight="64" infinite="1" backgroundcolor="#0b121c" nextlayerid="14" nextobjectid="${nextObjectId}">
 <tileset firstgid="1" source="train2-interior.tsx"/>
 <tileset firstgid="49" source="train2-exterior.tsx"/>
 <tileset firstgid="97" source="train2-nose.tsx"/>
 <tileset firstgid="157" source="train2-service-details.tsx"/>
 <properties>${property('reference', 'string', '../references/photo_2026-09-20_15-09-56.jpg')}${property('millimetersPerPixel', 'int', 5)}${property('carriageCount', 'int', 4)}${property('carriageLengthMm', 'int', 24000)}${property('planView', 'bool', true)}</properties>
 ${imageLayers}
 ${elevationLayers}
 ${objectLayers}
</map>\n`;

for (const [index, car] of cars.entries()) {
  writeFileSync(fileURLToPath(new URL(`train2-${car.id}.svg`, dir)), carSvg(car, index));
}
writeFileSync(fileURLToPath(new URL('train2-service-details.svg', dir)), detailAtlas);
writeFileSync(fileURLToPath(new URL('train2-service-details.tsx', dir)), detailTsx);
writeFileSync(fileURLToPath(new URL('train2-long.tmx', dir)), map);
console.log(`Generated four-car train: ${cars.map((car) => `${car.title} ${car.rows} rows`).join('; ')}`);
