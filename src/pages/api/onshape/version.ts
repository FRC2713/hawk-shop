import { logServerError } from "~/server/errors";
import { onshapeErrorResponse } from "~/lib/onshapeApi/auth";
import type { APIRoute } from "astro";
import { fetchVersionFromOnshape } from "~/onshape_connector/utils/versionQuery.server";
import { requireAuth } from "~/lib/requireAuth";

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

    // Provide more specific error messages
    let errorMessage = "Failed to fetch version";
    let statusCode = 500;

    const known = onshapeErrorResponse(error);
    if (known) return known;
    if (error instanceof Error) {
      if (
        error.message.includes("Not authenticated") ||
        error.message.includes("invalid_token")
      ) {
        errorMessage =
          "Onshape API credentials were rejected. Ask the deployment operator to check the key permissions.";
        statusCode = 409;
      } else if (
        error.message.includes("not found") ||
        error.message.includes("404")
      ) {
        errorMessage = "Version not found";
        statusCode = 404;
      } else {
        errorMessage = error.message;
      }
    }

    return Response.json(
      { error: errorMessage, errorId },
      { status: statusCode }
    );
  }
};
