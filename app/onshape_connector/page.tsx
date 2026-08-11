import { MfgPartsClient } from "./parts-client";
import type { Metadata } from "next";
import {
  QueryClient,
  dehydrate,
  HydrationBoundary,
} from "@tanstack/react-query";
import { getPartsQueryKey } from "./utils/partsQuery";
import { fetchPartsFromOnshape } from "./utils/partsQuery.server";
import {
  fetchKanbanCardsServer,
  fetchKanbanColumnsServer,
} from "~/lib/kanbanApi/queries.server";
import { kanbanQueryKeys } from "~/lib/kanbanApi/queries";

export const metadata: Metadata = {
  title: "MFG Parts - Onshape Integration",
  description: "View parts from Onshape Part Studio",
};

/**
 * Query parameters for the parts page
 * @example /onshape_connector?elementType=PARTSTUDIO&documentId={$documentId}&instanceType={$workspaceOrVersion}&instanceId={$workspaceOrVersionId}&elementId={$elementId}
 */
export type PartsPageSearchParams = {
  documentId: string;
  instanceType: "w" | "v" | "m";
  instanceId: string;
  elementId: string;
  elementType: string;
};

export default async function MfgParts({
  searchParams,
}: {
  searchParams: Promise<PartsPageSearchParams>;
}) {
  const queryParams = await searchParams;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000, // Cache for 30 seconds
      },
    },
  });

  // Prefetch parts data if we have the required parameters
  let prefetchError: string | null = null;
  if (queryParams.documentId) {
    try {
      await queryClient.prefetchQuery({
        queryKey: getPartsQueryKey(queryParams),
        queryFn: async () => {
          // Use read-only mode for server component prefetching (no token refresh)
          return await fetchPartsFromOnshape(queryParams, false);
        },
        staleTime: 30 * 1000, // Cache for 30 seconds
      });
    } catch (error) {
      console.error("Error prefetching parts:", error);
      // Extract error message for display
      if (error instanceof Error) {
        prefetchError = error.message;
      } else {
        prefetchError = "Failed to fetch parts from Onshape";
      }
      // Don't set query data on error - let client handle it
    }
  }

  // Prefetch kanban cards and columns for better initial load performance
  try {
    await queryClient.prefetchQuery({
      queryKey: kanbanQueryKeys.cards(),
      queryFn: fetchKanbanCardsServer,
      staleTime: 30 * 1000, // Cache for 30 seconds
    });
  } catch (error) {
    console.error("Error prefetching kanban cards:", error);
    // Non-fatal - let client handle it
  }

  try {
    await queryClient.prefetchQuery({
      queryKey: kanbanQueryKeys.columns(),
      queryFn: fetchKanbanColumnsServer,
      staleTime: 60 * 1000, // Cache for 1 minute
    });
  } catch (error) {
    console.error("Error prefetching kanban columns:", error);
    // Non-fatal - let client handle it
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MfgPartsClient
        queryParams={queryParams}
        error={prefetchError}
        exampleUrl={null}
      />
    </HydrationBoundary>
  );
}
