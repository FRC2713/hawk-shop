import { DoneClient } from "./done-client";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Done Cards - Kanban Board",
  description: "View all completed kanban cards",
};

export default async function DonePage() {
  return <DoneClient />;
}
