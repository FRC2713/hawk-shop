import { NextRequest, NextResponse } from "next/server";
import { contentTypeForPath, readStoredFile } from "~/lib/storage/files";

/**
 * Serves uploaded images out of the local uploads directory. This is the
 * self-hosted stand-in for Supabase Storage's public bucket URLs.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const storagePath = segments.map((s) => decodeURIComponent(s)).join("/");

  const file = await readStoredFile(storagePath);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": contentTypeForPath(storagePath),
      // Stored files are content-addressed or uniquely named, so they never
      // change under the same path.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
