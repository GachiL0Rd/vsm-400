const ENDINGS = [
  'иями',
  'ями',
  'ами',
  'ого',
  'его',
  'ому',
  'ему',
  'ыми',
  'ими',
  'ить',
  'ать',
  'ять',
  'еть',
  'оть',
  'ешь',
  'ишь',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ую',
  'юю',
  'ах',
  'ях',
  'ов',
  'ев',
  'ам',
  'ям',
  'ом',
  'ем',
  'ий',
  'ый',
  'ой',
  'ей',
  'ою',
  'ею',
  'ит',
  'ет',
  'ут',
  'ют',
  'ал',
  'ил',
  'ла',
  'ло',
  'ли',
  'а',
  'я',
  'ы',
  'и',
  'у',
  'ю',
  'е',
  'о',
  'ь',
];

/** Регистр и «ё» не различаются, пунктуация не входит в сравнение. */
export function normalizeRu(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-я0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(value: string): string[] {
  const normalized = normalizeRu(value);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(' ');
}

/** Одна самая длинная флексия. Основа короче 3 букв не отрезается. */
export function stemRu(word: string): string {
  if (word.length < 4) {
    return word;
  }
  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 3) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

const VOWEL_TAIL = /^[аеиоуыэюяйь]+$/;

function stemsClose(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  const size = Math.min(left.length, right.length);
  if (size < 3) {
    return false;
  }
  return left.startsWith(right) || right.startsWith(left);
}

function commonPrefix(left: string, right: string): number {
  const size = Math.min(left.length, right.length);
  let index = 0;
  while (index < size && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

/** «уши» и «ушей»: общий кусок и дальше только гласные окончания. */
function inflection(left: string, right: string): boolean {
  const prefix = commonPrefix(left, right);
  if (prefix < 2) {
    return false;
  }
  const leftTail = left.slice(prefix);
  const rightTail = right.slice(prefix);
  if (leftTail.length === 0 || rightTail.length === 0) {
    return false;
  }
  return VOWEL_TAIL.test(leftTail) && VOWEL_TAIL.test(rightTail);
}

function tokenMatch(textWord: string, anchorWord: string): boolean {
  if (stemsClose(stemRu(textWord), stemRu(anchorWord))) {
    return true;
  }
  return inflection(textWord, anchorWord);
}

export function containsAnchor(text: string, anchor: string): boolean {
  const textWords = tokens(text);
  const anchorTokens = tokens(anchor);
  if (anchorTokens.length === 0) {
    return false;
  }
  return anchorTokens.every((word) => textWords.some((item) => tokenMatch(item, word)));
}

export function applicableKeep(keep: readonly string[], sourceText: string): string[] {
  return keep.filter((anchor) => containsAnchor(sourceText, anchor));
}

export function signatureOf(text: string): string {
  return tokens(text).map(stemRu).sort().join('|');
}
