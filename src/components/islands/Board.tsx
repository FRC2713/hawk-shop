import { Workflow } from "./Workflow";
import { MfgKanbanClient } from "~/components/app/kanban-client";
export default function Board() {
  return (
    <Workflow>
      <MfgKanbanClient />
    </Workflow>
  );
}
