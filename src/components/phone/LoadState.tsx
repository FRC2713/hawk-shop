import type { ReactNode } from "react";
import { ErrorMessage } from "~/components/mfg/ErrorDisplay";
import { Button } from "~/components/ui/button";

type Loadable = {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
};

/**
 * What a phone screen shows before its queries are ready: a loading line
 * while any is pending, or the first failure with "Try again" (which refetches
 * every failed query). Null once all have data, so the screen renders itself.
 */
export function loadState(
  queries: Loadable[],
  loading: string,
  { title, cardId }: { title?: string; cardId?: string } = {}
): ReactNode | null {
  const failed = queries.filter((query) => query.isError);
  if (failed.length > 0)
    return (
      <section role="alert" className="space-y-2">
        {title && <h1 className="text-2xl">{title}</h1>}
        <ErrorMessage
          error={failed[0].error ?? "Something went wrong"}
          cardId={cardId}
        />
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => failed.forEach((query) => query.refetch())}
        >
          Try again
        </Button>
      </section>
    );
  if (queries.some((query) => query.isPending))
    return (
      <p role="status" className="text-muted-foreground">
        {loading}
      </p>
    );
  return null;
}
