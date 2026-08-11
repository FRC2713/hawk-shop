import { createFileRoute } from "@tanstack/react-router";
import {
  createOnshapeApiClient,
  getVersion,
} from "~/lib/onshapeApi/generated-wrapper";

/**
 * API endpoint to fetch version information from Onshape
 * Returns version name and other metadata
 */
export const Route = createFileRoute("/api/onshape/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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
          // Create Onshape API client with authentication
          const client = await createOnshapeApiClient();

          // Fetch version information
          const response = await getVersion({
            client,
            path: {
              did: documentId,
              vid: versionId,
            },
          });

          if (!response.data) {
            return Response.json(
              { error: "Version not found" },
              { status: 404 }
            );
          }

          // Return version data as JSON
          return Response.json(response.data);
        } catch (error) {
          console.error("Error fetching version from Onshape:", error);

          // Provide more specific error messages
          let errorMessage = "Failed to fetch version";
          let statusCode = 500;

          if (error instanceof Error) {
            if (
              error.message.includes("Not authenticated") ||
              error.message.includes("invalid_token")
            ) {
              errorMessage =
                "Not authenticated with Onshape. Please sign in again.";
              statusCode = 401;
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

          return Response.json({ error: errorMessage }, { status: statusCode });
        }
      },
    },
  },
});
