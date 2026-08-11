import { Card, CardContent } from "~/components/ui/card";
import { AlertCircle } from "lucide-react";

interface ErrorDisplayProps {
  error: string;
  exampleUrl?: string;
}

/**
 * Component to display error messages with optional example URL
 */
export function ErrorDisplay({ error, exampleUrl }: ErrorDisplayProps) {
  return (
    <Card className="border-destructive">
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm font-semibold">Error</p>
          </div>
          <p className="text-sm">{error}</p>
          {exampleUrl && (
            <div className="bg-muted mt-4 space-y-2 rounded-md p-3 text-xs">
              <p className="font-semibold">Example URL format:</p>
              <code className="bg-background block rounded px-2 py-1 break-all">
                {exampleUrl}
              </code>
              <p className="text-muted-foreground">
                When used in Onshape, placeholders like {"{$documentId}"} are
                automatically replaced with actual values.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
