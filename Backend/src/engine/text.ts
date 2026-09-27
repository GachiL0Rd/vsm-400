import type { Rng } from './rng';
import { type DecisionNode, type EndNode, isEndNode, type ScenarioNode } from './schema';
import type { TextVariant } from './types';

/**
 * Подменяет тексты узла и выборов. Эффекты, next и вердикт остаются.
 * Чужой набор id отбрасывается целиком: возвращается тот же узел.
 */
export function applyTextVariant(
  node: DecisionNode,
  variant: TextVariant | undefined,
): DecisionNode;
export function applyTextVariant(node: EndNode, variant: TextVariant | undefined): EndNode;
export function applyTextVariant(
  node: ScenarioNode,
  variant: TextVariant | undefined,
): ScenarioNode;
export function applyTextVariant(
  node: ScenarioNode,
  variant: TextVariant | undefined,
): ScenarioNode {
  if (variant === undefined || !choiceIdsMatch(node, variant)) {
    return node;
  }
  if (isEndNode(node)) {
    return { ...node, text: variant.text };
  }
  const texts = new Map(variant.choices.map((choice) => [choice.id, choice.text]));
  return {
    ...node,
    text: variant.text,
    choices: node.choices.map((choice) => {
      const text = texts.get(choice.id);
      if (text === undefined) {
        return choice;
      }
      return { ...choice, text };
    }),
  };
}

/** Тот же rng → тот же порядок. Исходный массив не меняется: shuffle копирует. */
export function orderChoices<T>(choices: readonly T[], rng: Rng): T[] {
  return rng.shuffle(choices);
}

function choiceIdsMatch(node: ScenarioNode, variant: TextVariant): boolean {
  const nodeIds = isEndNode(node) ? [] : node.choices.map((choice) => choice.id);
  if (nodeIds.length !== variant.choices.length) {
    return false;
  }
  const variantIds = new Set<string>();
  for (const choice of variant.choices) {
    if (variantIds.has(choice.id)) {
      return false;
    }
    variantIds.add(choice.id);
  }
  const seen = new Set<string>();
  for (const id of nodeIds) {
    if (seen.has(id) || !variantIds.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return seen.size === variantIds.size;
}
