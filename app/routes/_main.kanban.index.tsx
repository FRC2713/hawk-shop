import { createFileRoute } from "@tanstack/react-router";
import { MfgKanbanClient } from "~/components/app/kanban-client";

export const Route = createFileRoute("/_main/kanban/")({
  validateSearch: (search: Record<string, unknown>): { cardId?: string } => ({
    cardId:
      typeof search.cardId === "string" && search.cardId
        ? search.cardId
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Kanban Board - Manufacturing" },
      { name: "description", content: "Configure your Kanban board columns" },
    ],
  }),
  component: KanbanPage,
});

function KanbanPage() {
  const { cardId } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MfgKanbanClient
      cardId={cardId}
      onCloseCard={() => {
        void navigate({ search: {}, replace: true });
      }}
    />
  );
}
