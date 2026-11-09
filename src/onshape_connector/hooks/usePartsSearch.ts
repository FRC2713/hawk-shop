import { useMemo, useEffect, useState } from "react";
import Fuse from "fuse.js";
import { buildSearchIndex } from "~/lib/search";
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

  // Rebuild on metadata changes too, even when every part keeps the same id.
  const index = useMemo(() => {
    const entries = (parts || []).map((part, position) => ({
      id: String(position),
      part,
    }));
    return buildSearchIndex(entries, [
      { value: ({ part }) => part.name, weight: 2 },
      { value: ({ part }) => part.partNumber, weight: 2 },
    ]);
  }, [parts]);

  const fuse = useMemo(
    () =>
      new Fuse(parts || [], {
        keys: ["name", "partNumber"],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 1,
      }),
    [parts]
  );

  // Filter parts based on search query
  const filteredParts = useMemo(() => {
    if (!parts) {
      return [];
    }

    if (!debouncedSearchQuery.trim()) {
      return parts;
    }

    const matches = index.search(debouncedSearchQuery);
    if (matches.length) return matches.map(({ id }) => parts[Number(id)]!);

    // Preserve typo and infix searches when the shared matcher has no result.
    return fuse.search(debouncedSearchQuery).map((result) => result.item);
  }, [parts, index, fuse, debouncedSearchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    filteredParts,
    isSearching,
  };
}
