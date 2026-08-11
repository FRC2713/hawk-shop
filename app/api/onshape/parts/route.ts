import { NextRequest, NextResponse } from "next/server";
import { fetchPartsFromOnshape } from "~/onshape_connector/utils/partsQuery.server";

/**
 * API endpoint to fetch parts from Onshape with server-side authentication
 * This allows the client to fetch parts without exposing the access token
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;

  // Extract query parameters
  const documentId = url.searchParams.get("documentId");
  const instanceType = url.searchParams.get("instanceType");
  const instanceId = url.searchParams.get("instanceId");
  const elementId = url.searchParams.get("elementId");

  if (!documentId || !instanceType || !instanceId || !elementId) {
    return NextResponse.json(
      { error: "Missing required parameters" },
      { status: 400 }
    );
  }

  try {
    // Use shared utility function to fetch parts
    // allowTokenRefresh=true because this is a Route Handler where cookies can be modified
    const parts = await fetchPartsFromOnshape(
      {
        documentId,
        instanceType: instanceType as "w" | "v" | "m",
        instanceId,
        elementId,
        elementType: "", // Not used in fetching
      },
      true // Allow token refresh in route handlers
    );

    // Return parts data as JSON
    return NextResponse.json(parts);
  } catch (error) {
    console.error("Error fetching parts from Onshape:", error);

    // Provide more specific error messages
    let errorMessage = "Failed to fetch parts";
    let statusCode = 500;

    if (error instanceof Error) {
      if (error.message.includes("Not authenticated")) {
        errorMessage = "Not authenticated with Onshape. Please sign in again.";
        statusCode = 401;
      } else {
        errorMessage = error.message;
      }
    }

    return NextResponse.json({ error: errorMessage }, { status: statusCode });
  }
}
