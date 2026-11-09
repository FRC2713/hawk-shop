import { useEffect, useRef, useState } from "react";

/** Shareable search state and the board search keyboard shortcut. */
export function useUrlSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const restoreSearch = () =>
      setSearchQuery(new URL(window.location.href).searchParams.get("q") || "");
    restoreSearch();
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.closest("input, textarea, select, [role='textbox']") ||
            target.isContentEditable))
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("popstate", restoreSearch);
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("popstate", restoreSearch);
      window.removeEventListener("keydown", focusSearch);
    };
  }, []);

  const changeSearch = (query: string) => {
    setSearchQuery(query);
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(window.history.state, "", url);
  };
  return { searchQuery, changeSearch, searchRef };
}
