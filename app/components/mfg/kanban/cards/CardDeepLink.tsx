import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "~/components/ui/sheet";
import {
  deleteKanbanCard,
  kanbanCardsQuery,
  queryKeys,
  usersQuery,
} from "~/lib/api";
import { KanbanCardDetails } from "./KanbanCardDetails";

// Resolve against all cards, including completed cards hidden from the board.
export function CardDeepLink({
  cardId,
  onClose,
}: {
  cardId?: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { data: cards = [], isPending, error } = useQuery(kanbanCardsQuery());
  const { data: users = [] } = useQuery(usersQuery());
  const card = cards.find((card) => card.id === cardId);
  const deletion = useMutation({
    mutationFn: deleteKanbanCard,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.kanban.cards() });
      onClose();
    },
  });
  return (
    <Sheet
      open={!!cardId}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {card ? (
        <KanbanCardDetails
          card={card}
          imageUrl={
            card.image_url || card.onshape_document_id
              ? `/api/onshape/thumbnail?cardId=${encodeURIComponent(card.id)}`
              : undefined
          }
          deleteCardMutation={deletion}
          onDelete={() => deletion.mutate(card.id)}
          usersMap={new Map(users.map((user) => [user.onshape_user_id, user]))}
        />
      ) : (
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {isPending
                ? "Loading card"
                : error
                  ? "Unable to load card"
                  : "Card unavailable"}
            </SheetTitle>
            <SheetDescription>
              {isPending
                ? "Loading manufacturing details."
                : error
                  ? "Reload the page to try again."
                  : "This card may have been deleted."}
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      )}
    </Sheet>
  );
}
