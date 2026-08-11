import { useMemo, useEffect, useState, useRef } from "react";
import Fuse from "fuse.js";
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

/**
 * Hook for searching and filtering parts using Fuse.js
 * Optimizes Fuse instance creation by only recreating when parts data actually changes
 */
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

  // Create Fuse instance only when parts data actually changes
  // Compare by length and first/last item IDs to detect changes efficiently
  const previousLengthRef = useRef<number | undefined>(undefined);
  const previousFirstIdRef = useRef<string | undefined>(undefined);
  const previousLastIdRef = useRef<string | undefined>(undefined);
  const fuseRef = useRef<Fuse<BtPartMetadataInfo> | null>(null);

  const fuse = useMemo(() => {
    if (!parts || parts.length === 0) {
      previousLengthRef.current = 0;
      previousFirstIdRef.current = undefined;
      previousLastIdRef.current = undefined;
      fuseRef.current = null;
      return null;
    }

    // Quick check: compare length and first/last item IDs
    const currentLength = parts.length;
    const currentFirstId =
      parts[0]?.partId || parts[0]?.id || parts[0]?.partIdentity || "";
    const currentLastId =
      parts[parts.length - 1]?.partId ||
      parts[parts.length - 1]?.id ||
      parts[parts.length - 1]?.partIdentity ||
      "";

    const hasChanged =
      currentLength !== previousLengthRef.current ||
      currentFirstId !== previousFirstIdRef.current ||
      currentLastId !== previousLastIdRef.current;

    // If data appears unchanged and we have a fuse instance, reuse it
    if (!hasChanged && fuseRef.current) {
      return fuseRef.current;
    }

    // Update refs
    previousLengthRef.current = currentLength;
    previousFirstIdRef.current = currentFirstId;
    previousLastIdRef.current = currentLastId;

    // Create new Fuse instance
    const newFuse = new Fuse(parts, {
      keys: ["name", "partNumber"],
      threshold: 0.4, // Lower = more strict, higher = more fuzzy
      ignoreLocation: true, // Search anywhere in the string
      minMatchCharLength: 1,
    });

    fuseRef.current = newFuse;
    return newFuse;
  }, [parts]);

  // Filter parts based on search query
  const filteredParts = useMemo(() => {
    if (!parts) {
      return [];
    }

    if (!debouncedSearchQuery.trim() || !fuse) {
      return parts;
    }

    return fuse.search(debouncedSearchQuery).map((result) => result.item);
  }, [parts, fuse, debouncedSearchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
    filteredParts,
    isSearching,
  };
}
