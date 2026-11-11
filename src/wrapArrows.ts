/**
 * For a row of ".part" elements that each start with an arrow: when a part wraps to the start
 * of a new line, its arrow is hidden but keeps its space, so the text lines up under the text
 * above. Use as `use:wrapArrows` on the element holding the parts.
 */
export function wrapArrows(node: HTMLElement) {
  const update = () => {
    const parts = [...node.querySelectorAll<HTMLElement>(":scope > .part")];
    parts.forEach((p, i) => p.classList.toggle("wrapped", i > 0 && p.offsetTop > parts[i - 1].offsetTop));
  };
  const observer = new ResizeObserver(update);
  observer.observe(node);
  update();
  return { destroy: () => observer.disconnect() };
}
