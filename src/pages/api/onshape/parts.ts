import { logServerError } from "~/server/errors";
import { onshapeErrorResponse } from "~/lib/onshapeApi/auth";
import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { fetchPartsFromOnshape } from "~/onshape_connector/utils/partsQuery.server";

/**
 * API endpoint to fetch parts from Onshape with server-side authentication
 * This allows the client to fetch parts without exposing the access token
 */
export const GET: APIRoute = async ({ request }) => {
  // Needing an Onshape token used to be this route's only gate. It is no
  // longer sufficient: a cache hit answers without ever reaching Onshape,
  // so an unauthenticated caller on the LAN would get the part list for
  // free. Gate it explicitly, like the other cache-backed routes.
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);

  // Extract query parameters
  const documentId = url.searchParams.get("documentId");
  const instanceType = url.searchParams.get("instanceType");
  const instanceId = url.searchParams.get("instanceId");
  const elementId = url.searchParams.get("elementId");

  if (!documentId || !instanceType || !instanceId || !elementId) {
    return Response.json(
      { error: "Missing required parameters" },
      { status: 400 }
    );
  }

  try {
    // Use shared utility function to fetch parts
    const parts = await fetchPartsFromOnshape({
      documentId,
      instanceType: instanceType as "w" | "v" | "m",
      instanceId,
      elementId,
      elementType: "", // Not used in fetching
    });

    // Return parts data as JSON
    return Response.json(parts);
  } catch (error) {
    const errorId = logServerError("ONSHAPE", error);

    // Provide more specific error messages
    let errorMessage = "Failed to fetch parts";
    let statusCode = 500;

    const known = onshapeErrorResponse(error);
    if (known) return known;
    if (error instanceof Error) {
      if (error.message.includes("Not authenticated")) {
        errorMessage =
          "Onshape API credentials were rejected. Ask the deployment operator to check the key permissions.";
        statusCode = 409;
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
