import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { KanbanConfig, KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import type { KanbanCardRow, UserRow } from "~/lib/db/types";

/**
 * Query keys for kanban-related queries
 */
export const kanbanQueryKeys = {
  config: () => ["kanban-config"] as const,
  cards: () => ["kanban-cards"] as const,
  columns: () => ["kanban-columns"] as const,
  users: () => ["users"] as const,
  user: (id: string) => ["users", id] as const,
} as const;

/**
 * Fetch Kanban configuration
 */
export async function fetchKanbanConfig(): Promise<KanbanConfig> {
  const response = await fetch("/api/kanban/config");
  if (!response.ok) {
    throw new Error("Failed to fetch Kanban config");
  }
  return response.json();
}

/**
 * Fetch all kanban cards
 */
export async function fetchKanbanCards(): Promise<{ cards: KanbanCardRow[] }> {
  const response = await fetch("/api/kanban/cards");
  if (!response.ok) {
    throw new Error("Failed to fetch cards");
  }
  return response.json();
}

/**
 * Fetch all kanban columns
 */
export async function fetchKanbanColumns(): Promise<KanbanColumn[]> {
  const response = await fetch("/api/kanban/config/columns");
  if (!response.ok) {
    throw new Error("Failed to fetch columns");
  }
  return response.json();
}

/**
 * Fetch all users
 */
export async function fetchUsers(): Promise<UserRow[]> {
  const response = await fetch("/api/users");
  if (!response.ok) {
    throw new Error("Failed to fetch users");
  }
  return response.json();
}

/**
 * Fetch a single user by ID
 */
export async function fetchUser(id: string): Promise<UserRow> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error("Failed to fetch user");
  }
  return response.json();
}

/**
 * React Query hook for Kanban config
 */
export function useKanbanConfig(
  options?: Omit<UseQueryOptions<KanbanConfig>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: kanbanQueryKeys.config(),
    queryFn: fetchKanbanConfig,
    staleTime: 60 * 1000, // Cache for 1 minute
    ...options,
  });
}

/**
 * React Query hook for Kanban cards
 */
export function useKanbanCards(
  options?: Omit<
    UseQueryOptions<{ cards: KanbanCardRow[] }>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: kanbanQueryKeys.cards(),
    queryFn: fetchKanbanCards,
    staleTime: 30 * 1000, // Cache for 30 seconds
    ...options,
  });
}

/**
 * React Query hook for Kanban columns
 */
export function useKanbanColumns(
  options?: Omit<UseQueryOptions<KanbanColumn[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: kanbanQueryKeys.columns(),
    queryFn: fetchKanbanColumns,
    staleTime: 60 * 1000, // Cache for 1 minute
    ...options,
  });
}

/**
 * React Query hook for all users
 */
export function useUsers(
  options?: Omit<UseQueryOptions<UserRow[]>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: kanbanQueryKeys.users(),
    queryFn: fetchUsers,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes (user data rarely changes)
    ...options,
  });
}

/**
 * React Query hook for a single user
 */
export function useUser(
  id: string | undefined,
  options?: Omit<UseQueryOptions<UserRow>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: kanbanQueryKeys.user(id || ""),
    queryFn: () => fetchUser(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    ...options,
  });
}
