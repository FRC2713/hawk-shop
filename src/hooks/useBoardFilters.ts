import { useEffect, useRef, useState } from "react";
import {
  EMPTY_BOARD_FILTERS,
  readBoardFilters,
  writeBoardFilters,
  type BoardFilters,
} from "~/lib/boardFilter";

const currentUrl = () => new URL(window.location.href);

/** Is the user typing somewhere a "/" belongs? */
function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (!!target.closest("input, textarea, select, [role='textbox']") ||
      target.isContentEditable)
  );
}

/**
 * Board filters kept in the URL (see {@link BoardFilters}), restored on
 * back/forward, plus the `/` shortcut that focuses `searchRef`.
 */
export function useBoardFilters() {
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_BOARD_FILTERS);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const restore = () => {
      setFilters(readBoardFilters(currentUrl().searchParams));
    };
    restore();
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTyping(event.target)
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("popstate", restore);
      window.removeEventListener("keydown", focusSearch);
    };
  }, []);

  const replaceUrl = (edit: (url: URL) => void) => {
    const url = currentUrl();
    edit(url);
    window.history.replaceState(window.history.state, "", url);
  };

  const changeFilters = (changes: Partial<BoardFilters>) =>
    setFilters((current) => {
      const next = { ...current, ...changes };
      replaceUrl((url) => writeBoardFilters(url, next));
      return next;
    });

  return {
    filters,
    changeFilters,
    clearFilters: () =>
      changeFilters({ ...EMPTY_BOARD_FILTERS, sort: filters.sort }),
    searchRef,
  };
}
