/** The four ids that identify a Part Studio to `/api/onshape/parts`. */
type OnshapePartsScope = {
  documentId: string;
  instanceType: string;
  instanceId: string;
  elementId: string;
};

/**
 * Every React Query key used by the app.
 *
 * Nothing outside this file should write a key literal: the invalidation in a
 * mutation and the `useQuery` it is meant to refresh have to agree, and they
 * only agree by construction if they call the same function.
 *
 * The key strings are the ones the app has always used, so existing caches and
 * the `useKanbanRealtime` subscriber keep matching.
 */
export const queryKeys = {
  equipment: {
    all: () => ["equipment"] as const,
  },
  processes: {
    all: () => ["processes"] as const,
  },
  users: {
    /** Prefix of `byId`, so invalidating this also drops every single-user entry. */
    all: () => ["users"] as const,
    byId: (id: string) => ["users", id] as const,
  },
  kanban: {
    config: () => ["kanban-config"] as const,
    cards: () => ["kanban-cards"] as const,
    columns: () => ["kanban-columns"] as const,
  },
  onshape: {
    /**
     * `withThumbnails` is part of the key on purpose: the two callers of
     * `/api/onshape/parts` ask for different payloads, and leaving it out let
     * whichever query ran first serve the other one from cache.
     */
    parts: (params: OnshapePartsScope, withThumbnails: boolean) =>
      [
        "onshape-parts",
        params.documentId,
        params.instanceType,
        params.instanceId,
        params.elementId,
        withThumbnails,
      ] as const,
    version: (documentId: string, versionId: string) =>
      ["onshape-version", documentId, versionId] as const,
  },
} as const;
