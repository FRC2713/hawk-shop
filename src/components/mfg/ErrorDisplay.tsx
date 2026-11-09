import { Card, CardContent } from "~/components/ui/card";
import { AlertCircle } from "lucide-react";
import { ReportProblemButton } from "~/components/app/report-problem";
import { getErrorId } from "~/lib/api/client";

interface ErrorDisplayProps {
  error: string | Error;
  errorId?: string;
  cardId?: string;
  exampleUrl?: string;
}

/**
 * Component to display error messages with optional example URL
 */
export function ErrorDisplay({
  error,
  errorId,
  cardId,
  exampleUrl,
}: ErrorDisplayProps) {
  return (
    <Card className="border-destructive">
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm font-semibold">Error</p>
          </div>
          <ErrorMessage error={error} errorId={errorId} cardId={cardId} />
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

/** Inline forms and toasts retain the same reference and report context. */
export function ErrorMessage({
  error,
  errorId,
  cardId,
}: Omit<ErrorDisplayProps, "exampleUrl">) {
  const message = typeof error === "string" ? error : error.message;
  const reference = errorId ?? getErrorId(error);
  return (
    <div className="space-y-2 text-sm" role="alert">
      <p>{message}</p>
      {reference && (
        <p>
          Error ID: <code>{reference}</code>
        </p>
      )}
      <ReportProblemButton
        context={{
          error_id: reference,
          error_message: message,
          ...(cardId ? { card_id: cardId } : {}),
        }}
      />
    </div>
  );
}
