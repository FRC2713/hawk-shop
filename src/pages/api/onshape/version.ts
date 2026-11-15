import { logServerError } from "~/server/errors";
import { onshapeErrorResponse } from "~/lib/onshapeApi/auth";
import type { APIRoute } from "astro";
import type { BtVersionInfo } from "~/lib/onshapeApi/generated-wrapper";
import { VERSION_TTL_MS, cacheKey } from "~/lib/onshapeApi/cache";
import { onshapeRead, OnshapeRequestError } from "~/lib/onshapeApi/gateway";
import { requireAuth } from "~/lib/requireAuth";

/**
 * API endpoint to fetch version information from Onshape
 * Returns version name and other metadata
 *
 * Every kanban card detail sheet asks for its version's name, and a version is
 * frozen once cut — so this was the app's most repetitive spend against a quota
 * that is annual and company-wide. Answers are cached server-side for a week.
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
    // A failed read (a 404 is usually a key problem) throws and is never
    // cached, so it cannot hide the version for the whole week.
    const data = await onshapeRead<BtVersionInfo>({
      label: "version",
      cache: {
        key: cacheKey("version", documentId, versionId),
        ttlMs: VERSION_TTL_MS,
      },
      request: {
        path: `/v12/documents/d/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`,
      },
    });

    // Return version data as JSON
    return Response.json(data);
  } catch (error) {
    const errorId = logServerError("ONSHAPE", error);

    // Provide more specific error messages
    let errorMessage = "Failed to fetch version";
    let statusCode = 500;

    const known = onshapeErrorResponse(error);
    if (known) return known;
    if (error instanceof OnshapeRequestError && error.status === 404) {
      errorMessage = "Version not found";
      statusCode = 404;
    } else if (
      error instanceof OnshapeRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      errorMessage =
        "Onshape API credentials were rejected. Ask the deployment operator to check the key permissions.";
      statusCode = 409;
    } else if (error instanceof Error) {
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
