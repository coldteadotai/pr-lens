import { measure, type Face } from "../text.js";

export const words = (text: string): string[] => text.split(/\s+/).filter((word) => word.length > 0);

/** Greedy wrapping, which is also the fewest lines any wrapping needs. */
const wrapAt = (parts: readonly string[], face: Face, size: number, width: number): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const word of parts) {
    const joined = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(joined, face, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = joined;
    }
  }
  return line === "" ? lines : [...lines, line];
};

/** The fewest lines that fit, evened out by narrowing the column as far as it goes without adding a line. */
export const balancedLines = (text: string, face: Face, size: number, maxWidth: number): string[] => {
  const parts = words(text);
  const widest = wrapAt(parts, face, size, maxWidth);
  if (widest.length < 2) return widest;

  let low = 1;
  let high = maxWidth;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (wrapAt(parts, face, size, middle).length === widest.length) high = middle;
    else low = middle + 1;
  }
  return wrapAt(parts, face, size, low);
};
