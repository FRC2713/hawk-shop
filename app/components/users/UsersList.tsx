import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { UserRow } from "~/lib/db/types";
import { usersQuery } from "~/lib/api";

type UsersListProps = {
  onSelect: (user: UserRow | null) => void;
};

export function UsersList({ onSelect }: UsersListProps) {
  const { data: users } = useQuery(usersQuery());

  const sortedUsers = useMemo(() => {
    if (!users) return [];
    return [...users].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, {
        sensitivity: "base",
      })
    );
  }, [users]);

  return (
    <div className="flex max-h-[min(60vh,400px)] flex-col gap-2 overflow-y-auto">
      <div
        className="hover:bg-primary/10 flex cursor-pointer items-center gap-3 rounded-md border p-2"
        onClick={() => onSelect(null)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(null)}
        role="button"
        tabIndex={0}
      >
        <User className="text-muted-foreground size-4" />
        <span>None (Unassigned)</span>
      </div>
      {sortedUsers.map((user) => (
        <div
          className="hover:bg-primary/10 flex cursor-pointer items-center gap-3 rounded-md border p-2"
          key={user.onshape_user_id}
          onClick={() => onSelect(user)}
          onKeyDown={(e) => e.key === "Enter" && onSelect(user)}
          role="button"
          tabIndex={0}
        >
          <User className="text-primary size-4" />
          {user.name}
        </div>
      ))}
    </div>
  );
}
