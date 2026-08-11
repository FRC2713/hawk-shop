import { createFileRoute } from "@tanstack/react-router";
import { MfgKanbanClient } from "~/components/app/kanban-client";

export const Route = createFileRoute("/_main/kanban/")({
  head: () => ({
    meta: [
      { title: "Kanban Board - Manufacturing" },
      { name: "description", content: "Configure your Kanban board columns" },
    ],
  }),
  component: MfgKanbanClient,
});
