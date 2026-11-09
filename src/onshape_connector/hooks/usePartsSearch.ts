import { useMemo, useEffect, useState } from "react";
import { buildPartsSearch } from "../utils/partsSearch";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";

interface UsePartsSearchOptions {
  parts: BtPartMetadataInfo[] | undefined;
  debounceMs?: number;
}

interface UsePartsSearchResult {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  debouncedSearchQuery: string;
  filteredParts: BtPartMetadataInfo[];
  isSearching: boolean;
}

/** Shared part matching with the connector's fuzzy search as a fallback. */
export function usePartsSearch({
  parts,
  debounceMs = 300,
}: UsePartsSearchOptions): UsePartsSearchResult {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Debounce search query
  useEffect(() => {
    if (searchQuery.trim()) {
      setIsSearching(true);
    }
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setIsSearching(false);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      setIsSearching(false);
    };
  }, [searchQuery, debounceMs]);

  const index = useMemo(() => buildPartsSearch(parts || []), [parts]);
  const filteredParts = useMemo(
    () => index.search(debouncedSearchQuery),
    [index, debouncedSearchQuery]
  );

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    filteredParts,
    isSearching,
  };
}
