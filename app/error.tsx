"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>Oops!</h1>
      <p>An unexpected error occurred.</p>
      {error.message && <p className="text-destructive">{error.message}</p>}
      <button
        onClick={reset}
        className="bg-primary text-primary-foreground mt-4 rounded px-4 py-2"
      >
        Try again
      </button>
    </main>
  );
}
