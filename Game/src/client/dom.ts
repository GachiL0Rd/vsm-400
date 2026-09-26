export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const element = node('button', 'game-button', label);
  element.type = 'button';
  element.disabled = disabled;
  element.addEventListener('click', onClick);
  return element;
}

export function addLine(parent: HTMLElement, value: string, className = ''): void {
  parent.append(node('p', className, value));
}
