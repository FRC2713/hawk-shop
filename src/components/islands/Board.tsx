import { useEffect, useState } from "react";
import { Workflow } from "./Workflow";
import { MfgKanbanClient } from "~/components/app/kanban-client";
export default function Board({ cardId }: { cardId?: string }) {
  const [selectedCard, setSelectedCard] = useState(cardId);
  useEffect(() => {
    const update = () =>
      setSelectedCard(
        new URL(window.location.href).searchParams.get("cardId") || undefined
      );
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function closeCard() {
    setSelectedCard(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete("cardId");
    window.history.replaceState(null, "", url);
  }
  return (
    <Workflow>
      <MfgKanbanClient cardId={selectedCard} onCloseCard={closeCard} />
    </Workflow>
  );
}
