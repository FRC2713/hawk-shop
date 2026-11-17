/** "1 card", "3 cards"; pass `many` when adding an s is wrong. */
export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
