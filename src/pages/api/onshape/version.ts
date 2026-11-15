import { logServerError } from "~/server/errors";
import { onshapeErrorResponse } from "~/lib/onshapeApi/auth";
import type { APIRoute } from "astro";
import { fetchVersionFromOnshape } from "~/onshape_connector/utils/versionQuery.server";
import { requireAuth } from "~/lib/requireAuth";

/** A 404 from Onshape (its message names the status), or any error that says
 * "not found", is a missing version. */
function failure(error: Error) {
  return error.message.includes("not found") || error.message.includes("404")
    ? { error: "Version not found", status: 404 }
    : { error: error.message, status: 500 };
}

/**
 * API endpoint to fetch version information from Onshape
 * Returns version name and other metadata
 *
 * The connector reads it for the version it shows. Card details no longer
 * do: release captures the name onto the card (`onshape_version_name`).
 * A version is frozen once cut, so answers are cached server-side for a week.
 */
export const GET: APIRoute = async ({ request }) => {
  // A cache hit never reaches Onshape, so a token is no longer this
  // route's implicit gate — see the same note on `api/onshape/parts`.
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);

  // Extract query parameters
  const documentId = url.searchParams.get("documentId");
  const versionId = url.searchParams.get("versionId");

  if (!documentId || !versionId) {
    return Response.json(
      { error: "Missing required parameters: documentId and versionId" },
      { status: 400 }
    );
  }

  try {
    const data = await fetchVersionFromOnshape(documentId, versionId);

    // Return version data as JSON
    return Response.json(data);
  } catch (error) {
    const errorId = logServerError("ONSHAPE", error);
    const known = onshapeErrorResponse(error, {
      errorId,
      requestFailed: failure,
    });
    if (known) return known;
    const answer =
      error instanceof Error
        ? failure(error)
        : { error: "Failed to fetch version", status: 500 };
    return Response.json(
      { error: answer.error, errorId },
      { status: answer.status }
    );
  }
};
