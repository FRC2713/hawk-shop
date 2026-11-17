import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { queryKeys } from "./keys";

export type StationMember = { onshape_user_id: string; name: string | null };
type Roster = { shop_day: string; members: StationMember[] };
const path = (id: string) => `/api/processes/${encodeURIComponent(id)}/roster`;
export function stationRosterQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.kanban.stationRoster(id),
    queryFn: () =>
      apiFetch<Roster>(path(id), {
        fallbackError: "Failed to load today's members",
      }),
  });
}
export function removeStationMember(processId: string, userId: string) {
  return apiFetch<Roster>(path(processId), {
    method: "DELETE",
    json: { userId },
    fallbackError: "Failed to remove member",
  });
}

export function pickStationMember(processId: string, userId: string) {
  return apiFetch<Roster>(path(processId), {
    method: "POST",
    json: { userId },
    fallbackError: "Failed to add member to today's list",
  });
}
