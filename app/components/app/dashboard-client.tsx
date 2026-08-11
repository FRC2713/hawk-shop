import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  KanbanSquare,
  UserRound,
  Wrench,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  equipmentQuery,
  kanbanCardsQuery,
  kanbanConfigQuery,
  processesQuery,
  usersQuery,
  type KanbanCardWithProcesses,
} from "~/lib/api";

/** Cards this close to their due date show up under "Needs attention". */
const DUE_SOON_DAYS = 7;

/**
 * Bare `YYYY-MM-DD` due dates are local dates, not UTC midnight — same parse the
 * card editor uses, so the board and the dashboard agree on what "today" means.
 */
function parseLocalDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return parseISO(value);
}

/** Whole calendar days from today; negative once the date is past. */
function daysUntil(value: string): number {
  const due = parseLocalDate(value);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(days: number): string {
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

export function DashboardClient({ userName }: { userName: string | null }) {
  const { data: config } = useQuery(kanbanConfigQuery());
  const { data: cards = [], isLoading: cardsLoading } =
    useQuery(kanbanCardsQuery());
  const { data: equipment = [], isLoading: equipmentLoading } =
    useQuery(equipmentQuery());
  const { data: processes = [] } = useQuery(processesQuery());
  const { data: users = [] } = useQuery(usersQuery());

  // The last column is "done" — the same convention /kanban/done uses.
  const columns = config?.columns ?? [];
  const doneColumnId = columns.length ? columns[columns.length - 1].id : null;

  const board = useMemo(() => {
    const active = cards.filter((card) => card.column_id !== doneColumnId);
    const dated = active
      .filter((card) => card.due_date)
      .map((card) => ({ card, days: daysUntil(card.due_date!) }))
      .sort((a, b) => a.days - b.days);

    return {
      active,
      done: cards.filter((card) => card.column_id === doneColumnId),
      unassigned: active.filter((card) => !card.assignee),
      overdue: dated.filter((entry) => entry.days < 0),
      attention: dated.filter((entry) => entry.days <= DUE_SOON_DAYS),
      byColumn: columns.map((column) => ({
        column,
        count: cards.filter((card) => card.column_id === column.id).length,
      })),
    };
  }, [cards, columns, doneColumnId]);

  const recent = useMemo(
    () =>
      [...cards]
        .sort(
          (a, b) =>
            new Date(b.date_updated).getTime() -
            new Date(a.date_updated).getTime()
        )
        .slice(0, 5),
    [cards]
  );

  const userNames = useMemo(
    () => new Map(users.map((user) => [user.onshape_user_id, user.name])),
    [users]
  );

  const equipmentByStatus = useMemo(() => {
    const counts = { available: 0, "in-use": 0, maintenance: 0, retired: 0 };
    for (const item of equipment) {
      if (item.status && item.status in counts) {
        counts[item.status as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [equipment]);

  const boardTotal = board.byColumn.reduce((sum, e) => sum + e.count, 0);

  return (
    <main className="bg-background flex-1 overflow-y-auto">
      <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hawk Shop</h1>
            <p className="text-muted-foreground text-sm">
              Manufacturing, equipment, and processes for the shop.
            </p>
          </div>
          {userName && (
            <p className="text-muted-foreground text-sm">
              Signed in as <span className="text-foreground">{userName}</span>
            </p>
          )}
        </header>

        {/* At a glance */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            to="/kanban"
            label="Parts in progress"
            value={board.active.length}
            hint={`${board.done.length} done`}
            loading={cardsLoading}
          />
          <StatTile
            to="/kanban"
            label="Overdue"
            value={board.overdue.length}
            hint={`${board.attention.length - board.overdue.length} due within ${DUE_SOON_DAYS} days`}
            emphasis={board.overdue.length > 0}
            loading={cardsLoading}
          />
          <StatTile
            to="/kanban"
            label="Unassigned"
            value={board.unassigned.length}
            hint="of parts in progress"
            loading={cardsLoading}
          />
          <StatTile
            to="/equipment"
            label="Equipment"
            value={equipment.length}
            hint={
              equipmentByStatus.maintenance > 0
                ? `${equipmentByStatus.maintenance} in maintenance`
                : `${processes.length} processes`
            }
            emphasis={equipmentByStatus.maintenance > 0}
            loading={equipmentLoading}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Board breakdown */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <KanbanSquare className="text-muted-foreground size-4" />
                Board
              </CardTitle>
              <Link
                to="/kanban"
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                Open board
              </Link>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              {cardsLoading ? (
                <SkeletonRows count={4} />
              ) : boardTotal === 0 ? (
                <EmptyLine>
                  No cards yet. Release parts from Onshape to get started.
                </EmptyLine>
              ) : (
                board.byColumn.map(({ column, count }) => (
                  <div key={column.id} className="space-y-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{column.title}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    </div>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full rounded-full"
                        style={{
                          width: `${boardTotal ? (count / boardTotal) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
              <div className="flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground">
                  {board.done.length} completed
                </span>
                <Link
                  to="/kanban/done"
                  className="text-muted-foreground hover:text-foreground"
                >
                  View done
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Needs attention */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="text-muted-foreground size-4" />
                Needs attention
              </CardTitle>
              <span className="text-muted-foreground text-sm tabular-nums">
                {board.attention.length}
              </span>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-2">
              {cardsLoading ? (
                <SkeletonRows count={4} />
              ) : board.attention.length === 0 ? (
                <EmptyLine>
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="size-4" />
                    Nothing due in the next {DUE_SOON_DAYS} days.
                  </span>
                </EmptyLine>
              ) : (
                board.attention.slice(0, 6).map(({ card, days }) => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{card.title}</span>
                    <Badge
                      variant={days < 0 ? "destructive" : "secondary"}
                      className="shrink-0 font-normal"
                    >
                      {dueLabel(days)}
                    </Badge>
                  </div>
                ))
              )}
              {board.attention.length > 6 && (
                <p className="text-muted-foreground border-t pt-2 text-sm">
                  +{board.attention.length - 6} more on the board
                </p>
              )}
            </CardContent>
          </Card>

          {/* Equipment */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="text-muted-foreground size-4" />
                Equipment
              </CardTitle>
              <Link
                to="/equipment"
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                Manage
              </Link>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-2">
              {equipmentLoading ? (
                <SkeletonRows count={3} />
              ) : equipment.length === 0 ? (
                <EmptyLine>No equipment recorded yet.</EmptyLine>
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <StatusRow
                    label="Available"
                    value={equipmentByStatus.available}
                  />
                  <StatusRow
                    label="In use"
                    value={equipmentByStatus["in-use"]}
                  />
                  <StatusRow
                    label="Maintenance"
                    value={equipmentByStatus.maintenance}
                  />
                  <StatusRow
                    label="Retired"
                    value={equipmentByStatus.retired}
                  />
                </dl>
              )}
              <p className="text-muted-foreground border-t pt-3 text-sm">
                {processes.length} processes defined
              </p>
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader className="space-y-0 p-4 pb-2">
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-2">
              {cardsLoading ? (
                <SkeletonRows count={5} />
              ) : recent.length === 0 ? (
                <EmptyLine>Nothing has moved yet.</EmptyLine>
              ) : (
                recent.map((card) => (
                  <RecentRow
                    key={card.id}
                    card={card}
                    columnTitle={
                      columns.find((c) => c.id === card.column_id)?.title
                    }
                    assigneeName={
                      card.assignee
                        ? (userNames.get(card.assignee) ?? card.assignee)
                        : null
                    }
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function StatTile({
  to,
  label,
  value,
  hint,
  emphasis,
  loading,
}: {
  to: "/kanban" | "/kanban/done" | "/equipment";
  label: string;
  value: number;
  hint: string;
  emphasis?: boolean;
  loading?: boolean;
}) {
  return (
    <Link to={to} className="block">
      <Card className="hover:border-foreground/20 h-full transition-colors">
        <CardContent className="p-4">
          <p className="text-muted-foreground text-sm">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-8 w-12" />
          ) : (
            <p
              className={`text-3xl font-semibold tabular-nums ${
                emphasis ? "text-destructive" : ""
              }`}
            >
              {value}
            </p>
          )}
          <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatusRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between border-b pb-1 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function RecentRow({
  card,
  columnTitle,
  assigneeName,
}: {
  card: KanbanCardWithProcesses;
  columnTitle?: string;
  assigneeName: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="truncate">{card.title}</p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {columnTitle ?? card.column_id}
          {assigneeName && (
            <>
              <span aria-hidden>·</span>
              <UserRound className="size-3" />
              {assigneeName}
            </>
          )}
        </p>
      </div>
      <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
        {formatDistanceToNow(new Date(card.date_updated), { addSuffix: true })}
      </span>
    </div>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
