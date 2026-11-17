import { useBrowserPreference } from "./useBrowserPreference";

export type BoardDensity = "compact" | "pictures";

/** Compact cards or large pictures, remembered per browser. */
export function useBoardDensity() {
  const [density, setDensity] = useBrowserPreference<BoardDensity>(
    "hawk-shop:board-density",
    "compact",
    (stored) => (stored === "pictures" ? "pictures" : "compact")
  );
  return { density, setDensity };
}
