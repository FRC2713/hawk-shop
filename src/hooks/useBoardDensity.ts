import { useCallback, useState } from "react";

export type BoardDensity = "compact" | "pictures";

const STORAGE_KEY = "hawk-shop:board-density";

function readDensity(): BoardDensity {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "pictures"
      ? "pictures"
      : "compact";
  } catch {
    return "compact";
  }
}

/** Compact cards or large pictures, remembered per browser. */
export function useBoardDensity() {
  const [density, setDensityState] = useState<BoardDensity>(readDensity);
  const setDensity = useCallback((next: BoardDensity) => {
    setDensityState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows may refuse storage; the choice still holds for this visit.
    }
  }, []);
  return { density, setDensity };
}
