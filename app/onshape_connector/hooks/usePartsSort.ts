import { useMemo } from "react";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { KanbanCardRow } from "~/lib/db/types";
import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";

export type SortBy =
  | "none"
  | "name"
  | "partNumber"
  | "material"
  | "mfgState"
  | "createdAt"
  | "updatedAt";

export type SortDirection = "asc" | "desc";

interface UsePartsSortOptions {
  parts: BtPartMetadataInfo[];
  sortBy: SortBy;
  sortDirection: SortDirection;
  cardByPartNumber: Map<string, KanbanCardRow>;
  columnById: Map<string, KanbanColumn>;
}

/**
 * Hook for sorting parts with optimized performance
 * Pre-computes sort keys where possible to avoid repeated lookups
 */
export function usePartsSort({
  parts,
  sortBy,
  sortDirection,
  cardByPartNumber,
  columnById,
}: UsePartsSortOptions): BtPartMetadataInfo[] {
  return useMemo(() => {
    if (sortBy === "none") {
      return parts;
    }

    const partsToSort = [...parts];
    const directionMultiplier = sortDirection === "asc" ? 1 : -1;

    // Pre-compute sort keys for parts that have cards (for mfgState, createdAt, updatedAt)
    const sortKeyCache = new Map<
      string,
      {
        position?: number;
        createdAt?: number;
        updatedAt?: number;
      }
    >();

    if (
      sortBy === "mfgState" ||
      sortBy === "createdAt" ||
      sortBy === "updatedAt"
    ) {
      partsToSort.forEach((part) => {
        if (part.partNumber) {
          const card = cardByPartNumber.get(part.partNumber);
          if (card) {
            const column = card.column_id
              ? columnById.get(card.column_id)
              : undefined;
            sortKeyCache.set(part.partNumber, {
              position: column?.position ?? Number.MAX_SAFE_INTEGER,
              createdAt: new Date(card.date_created).getTime(),
              updatedAt: new Date(card.date_updated).getTime(),
            });
          }
        }
      });
    }

    switch (sortBy) {
      case "name":
        return partsToSort.sort((a, b) => {
          const nameA = (a.name || "").toLowerCase();
          const nameB = (b.name || "").toLowerCase();
          return nameA.localeCompare(nameB) * directionMultiplier;
        });

      case "partNumber":
        return partsToSort.sort((a, b) => {
          const numA = (a.partNumber || "").toLowerCase();
          const numB = (b.partNumber || "").toLowerCase();
          return numA.localeCompare(numB) * directionMultiplier;
        });

      case "material":
        return partsToSort.sort((a, b) => {
          const materialA = (a.material?.displayName || "").toLowerCase();
          const materialB = (b.material?.displayName || "").toLowerCase();
          // Parts without material go to the end
          if (!materialA && !materialB) return 0;
          if (!materialA) return 1;
          if (!materialB) return -1;
          return materialA.localeCompare(materialB) * directionMultiplier;
        });

      case "mfgState": {
        return partsToSort.sort((a, b) => {
          const cacheA = a.partNumber
            ? sortKeyCache.get(a.partNumber)
            : undefined;
          const cacheB = b.partNumber
            ? sortKeyCache.get(b.partNumber)
            : undefined;

          if (!cacheA && !cacheB) return 0;
          if (!cacheA) return 1; // Parts without cards go to the end
          if (!cacheB) return -1;

          const positionA = cacheA.position ?? Number.MAX_SAFE_INTEGER;
          const positionB = cacheB.position ?? Number.MAX_SAFE_INTEGER;

          return (positionA - positionB) * directionMultiplier;
        });
      }

      case "createdAt": {
        return partsToSort.sort((a, b) => {
          const cacheA = a.partNumber
            ? sortKeyCache.get(a.partNumber)
            : undefined;
          const cacheB = b.partNumber
            ? sortKeyCache.get(b.partNumber)
            : undefined;

          if (!cacheA && !cacheB) return 0;
          if (!cacheA) return 1; // Parts without cards go to the end
          if (!cacheB) return -1;

          // Base sort: newest first (dateB - dateA), then apply direction
          return (cacheB.createdAt! - cacheA.createdAt!) * directionMultiplier;
        });
      }

      case "updatedAt": {
        return partsToSort.sort((a, b) => {
          const cacheA = a.partNumber
            ? sortKeyCache.get(a.partNumber)
            : undefined;
          const cacheB = b.partNumber
            ? sortKeyCache.get(b.partNumber)
            : undefined;

          if (!cacheA && !cacheB) return 0;
          if (!cacheA) return 1; // Parts without cards go to the end
          if (!cacheB) return -1;

          // Base sort: most recently updated first (dateB - dateA), then apply direction
          return (cacheB.updatedAt! - cacheA.updatedAt!) * directionMultiplier;
        });
      }

      default:
        return partsToSort;
    }
  }, [parts, sortBy, sortDirection, cardByPartNumber, columnById]);
}
