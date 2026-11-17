import { useCallback } from "react";
import type { BoardRowsBy } from "~/lib/boardRows";
import { useBrowserPreference } from "./useBrowserPreference";

function readRows(stored: string | null): BoardRowsBy {
  // Old shared links still open project rows.
  if (new URL(window.location.href).searchParams.get("group") === "project")
    return "project";
  return stored === "process" || stored === "project" ? stored : "none";
}

/** Rows by process, project or none, remembered per browser. */
export function useBoardRows() {
  const [rowsBy, setStored] = useBrowserPreference<BoardRowsBy>(
    "hawk-shop:board-rows",
    "none",
    readRows
  );
  const setRowsBy = useCallback(
    (next: BoardRowsBy) => {
      setStored(next);
      // The browser remembers grouping now; drop the old link parameter.
      const url = new URL(window.location.href);
      if (url.searchParams.has("group")) {
        url.searchParams.delete("group");
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [setStored]
  );
  return { rowsBy, setRowsBy };
}
