import { useCallback, useEffect, useState } from "react";
import type { BoardRowsBy } from "~/lib/boardRows";

const STORAGE_KEY = "hawk-shop:board-rows";

function readRows(): BoardRowsBy {
  // Old shared links still open project rows.
  if (new URL(window.location.href).searchParams.get("group") === "project")
    return "project";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "process" || stored === "project" ? stored : "none";
  } catch {
    return "none";
  }
}

/**
 * Rows by process, project or none, remembered per browser. The board renders
 * on the server too, so the stored choice is read after hydration.
 */
export function useBoardRows() {
  const [rowsBy, setRowsByState] = useState<BoardRowsBy>("none");
  useEffect(() => setRowsByState(readRows()), []);
  const setRowsBy = useCallback((next: BoardRowsBy) => {
    setRowsByState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows may refuse storage; the choice still holds for this visit.
    }
    // The browser remembers grouping now; drop the old link parameter.
    const url = new URL(window.location.href);
    if (url.searchParams.has("group")) {
      url.searchParams.delete("group");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);
  return { rowsBy, setRowsBy };
}
