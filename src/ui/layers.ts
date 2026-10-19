// Stack of open overlays (dialog, drawer, popover, menu, tooltip), so Escape closes only the topmost one.

const stack: number[] = [];
let seq = 0;

/** Registers an overlay as the new top layer and returns its id. */
export function openLayer(): number {
  seq += 1;
  stack.push(seq);
  return seq;
}

export function closeLayer(id: number): void {
  const at = stack.indexOf(id);
  if (at >= 0) stack.splice(at, 1);
}

export function isTopLayer(id: number): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** Number of open layers; for tests and debugging. */
export function layerCount(): number {
  return stack.length;
}
