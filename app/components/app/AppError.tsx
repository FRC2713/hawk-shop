import { useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

/**
 * Router-level error boundary. Replaces the Next `app/error.tsx` convention;
 * `reset` there is `router.invalidate()` here — it re-runs the failed loaders
 * rather than remounting a segment.
 */
export function AppErrorComponent({ error }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>Oops!</h1>
      <p>An unexpected error occurred.</p>
      {error?.message && <p className="text-destructive">{error.message}</p>}
      <button
        onClick={() => router.invalidate()}
        className="bg-primary text-primary-foreground mt-4 rounded px-4 py-2"
      >
        Try again
      </button>
    </main>
  );
}
