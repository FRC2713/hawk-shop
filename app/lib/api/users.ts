import { queryOptions } from "@tanstack/react-query";
import type { UserRow } from "~/lib/db/types";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

export function usersQuery() {
  return queryOptions({
    queryKey: queryKeys.users.all(),
    queryFn: () =>
      apiFetch<UserRow[]>("/api/users", {
        fallbackError: "Failed to fetch users",
      }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Disabled when `id` is absent, so callers can pass a card's nullable assignee. */
export function userQuery(id: string | null | undefined) {
  return queryOptions({
    queryKey: queryKeys.users.byId(id ?? ""),
    queryFn: () =>
      apiFetch<UserRow>(`/api/users/${id}`, {
        fallbackError: "Failed to fetch user",
      }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}
