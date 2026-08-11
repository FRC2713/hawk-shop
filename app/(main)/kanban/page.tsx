import { MfgKanbanClient } from "./kanban-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kanban Board - Manufacturing",
  description: "Configure your Kanban board columns",
};

export default async function MfgKanban() {
  return <MfgKanbanClient />;
}
