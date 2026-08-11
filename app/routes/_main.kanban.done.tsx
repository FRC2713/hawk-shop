import { createFileRoute } from "@tanstack/react-router";
import { DoneClient } from "~/components/app/done-client";

export const Route = createFileRoute("/_main/kanban/done")({
  head: () => ({
    meta: [
      { title: "Done Cards - Kanban Board" },
      { name: "description", content: "View all completed kanban cards" },
    ],
  }),
  component: DoneClient,
});
