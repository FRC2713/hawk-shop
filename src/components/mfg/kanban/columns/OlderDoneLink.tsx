import { ArrowRight } from "lucide-react";
import { Button } from "~/components/ui/button";
import { plural } from "~/lib/plural";
import { cn } from "~/lib/utils";

/** The board's Done shows today's parts; this goes to the older ones. */
export function OlderDoneLink({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <Button
      asChild
      variant="outline"
      className={cn(
        "hover:bg-muted/50 flex items-center justify-center gap-2 border-dashed",
        className
      )}
    >
      <a href="/kanban/done">
        <span className="text-sm font-medium">
          View {plural(count, "older part")}
        </span>
        <ArrowRight className="size-4" aria-hidden="true" />
      </a>
    </Button>
  );
}
