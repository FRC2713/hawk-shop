import { useMemo } from "react";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { KanbanCardRow } from "~/lib/db/types";
import type { KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import { useQuery } from "@tanstack/react-query";
import {
  kanbanCardsQuery,
  kanbanColumnsQuery,
  onshapePartsQuery,
} from "~/lib/api";
import type { PartsPageSearchParams } from "../utils/types";
import { getPartVersionKey, getCardVersionId } from "../utils/versionUtils";

interface UsePartsDataOptions {
  queryParams: PartsPageSearchParams;
}

interface UsePartsDataResult {
  parts: BtPartMetadataInfo[] | undefined;
  cards: KanbanCardRow[];
  columns: KanbanColumn[];
  cardByPartNumber: Map<string, KanbanCardRow>;
  columnById: Map<string, KanbanColumn>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  partsError: Error | null;
  cardsError: Error | null;
  columnsError: Error | null;
}

/**
 * Hook that combines parts, cards, and columns queries
 * Creates lookup maps for efficient access
 * Returns unified loading and error states
 */
export function usePartsData({
  queryParams,
}: UsePartsDataOptions): UsePartsDataResult {
  // Fetch all three data sources
  const partsQuery = useQuery(
    onshapePartsQuery(queryParams, { withThumbnails: true })
  );
  const cardsQuery = useQuery(kanbanCardsQuery());
  const columnsQuery = useQuery(kanbanColumnsQuery());

  const parts = partsQuery.data;
  const cards = cardsQuery.data || [];
  const columns = columnsQuery.data || [];

  // Create lookup maps for O(1) access
  // Use composite key (partNumber::versionId) for matching
  const cardByPartNumber = useMemo(() => {
    const map = new Map<string, KanbanCardRow>();
    cards.forEach((card) => {
      if (card.title) {
        // Get version ID from card
        const versionId = getCardVersionId(card);
        if (versionId) {
          // Use composite key: partNumber::versionId
          const compositeKey = getPartVersionKey(card.title, versionId);
          map.set(compositeKey, card);
        } else {
          // Fallback for backward compatibility: use just partNumber
          // This handles old cards that don't have version_id set
          map.set(card.title, card);
        }
      }
    });
    return map;
  }, [cards]);

  const columnById = useMemo(() => {
    const map = new Map<string, KanbanColumn>();
    columns.forEach((col) => {
      map.set(col.id, col);
    });
    return map;
  }, [columns]);

  // Unified loading and error states
  const isLoading =
    partsQuery.isLoading || cardsQuery.isLoading || columnsQuery.isLoading;

  const partsError = partsQuery.error as Error | null;
  const cardsError = cardsQuery.error as Error | null;
  const columnsError = columnsQuery.error as Error | null;

  const isError = !!partsError || !!cardsError || !!columnsError;
  const error = partsError || cardsError || columnsError || null;

  return {
    parts,
    cards,
    columns,
    cardByPartNumber,
    columnById,
    isLoading,
    isError,
    error,
    partsError,
    cardsError,
    columnsError,
  };
}
