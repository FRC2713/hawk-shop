import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";

/**
 * Skeleton component for PartCard loading state
 */
export function PartCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="mt-2 h-4 w-24" />
      </CardHeader>
      <div className="px-6 pb-4">
        <Skeleton
          className="w-full rounded border"
          style={{ height: "300px" }}
        />
      </div>
      <CardContent>{/* Empty content for spacing */}</CardContent>
    </Card>
  );
}
