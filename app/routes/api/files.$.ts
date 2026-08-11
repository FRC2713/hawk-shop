import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "~/lib/requireAuth";
import { contentTypeForPath, readStoredFile } from "~/lib/storage/files";

/**
 * Serves uploaded images out of the local uploads directory. This is the
 * self-hosted stand-in for Supabase Storage — but for a *private* bucket: it
 * requires a session, so uploads cannot be enumerated by anyone who reaches the
 * port. Same-origin `<img>` requests carry the auth cookies, so the UI is
 * unaffected.
 */
export const Route = createFileRoute("/api/files/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const unauthorized = await requireAuth();
        if (unauthorized) return unauthorized;

        // The splat arrives already joined; `resolveStoragePath` is what
        // rejects anything trying to climb out of the uploads root.
        const storagePath = (params._splat ?? "")
          .split("/")
          .map((s) => decodeURIComponent(s))
          .join("/");

        const file = await readStoredFile(storagePath);
        if (!file) {
          return Response.json({ error: "File not found" }, { status: 404 });
        }

        return new Response(new Uint8Array(file), {
          headers: {
            "Content-Type": contentTypeForPath(storagePath),
            // Stored files are content-addressed or uniquely named, so they
            // never change under the same path.
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
