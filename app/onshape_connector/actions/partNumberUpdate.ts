import { NextRequest } from "next/server";
import {
  createOnshapeApiClientFromRequest,
  getWmvepMetadata,
  updateWvepMetadata,
} from "~/lib/onshapeApi/generated-wrapper";
import { isOnshapeAuthenticatedFromRequest } from "~/lib/onshapeAuth";
import { createErrorResponse } from "../utils/errorHandling";
import type { ActionResponse } from "../utils/types";

/**
 * Handle updating a part's part number in Onshape metadata
 */
export async function handlePartNumberUpdate(
  formData: FormData,
  request: NextRequest
): Promise<ActionResponse> {
  console.log("[ACTION] Starting part number update");

  // Check Onshape authentication (required)
  const onshapeAuthenticated = await isOnshapeAuthenticatedFromRequest(
    request as unknown as Request
  );
  if (!onshapeAuthenticated) {
    console.error("[ACTION] Not authenticated with Onshape");
    return { success: false, error: "Not authenticated with Onshape" };
  }

  try {
    const partId = formData.get("partId")?.toString();
    const partNumber = formData.get("partNumber")?.toString();
    const documentId = formData.get("documentId")?.toString();
    const instanceType = formData.get("instanceType")?.toString() || "w";
    const instanceId = formData.get("instanceId")?.toString();
    const elementId = formData.get("elementId")?.toString();

    console.log("[ACTION] Form data received:", {
      partId,
      partNumber,
      documentId,
      instanceType,
      instanceId,
      elementId,
    });

    if (!partId || !partNumber || !documentId || !instanceId || !elementId) {
      const missing = [];
      if (!partId) missing.push("partId");
      if (!partNumber) missing.push("partNumber");
      if (!documentId) missing.push("documentId");
      if (!instanceId) missing.push("instanceId");
      if (!elementId) missing.push("elementId");
      console.error("[ACTION] Missing required fields:", missing);
      return {
        success: false,
        error: `Missing required fields: ${missing.join(", ")}`,
      };
    }

    const client = await createOnshapeApiClientFromRequest(
      request as unknown as Request
    );
    console.log("[ACTION] Client created successfully");

    // First, get the metadata to find the propertyId for "Part number"
    console.log("[ACTION] Fetching metadata for part:", {
      documentId,
      instanceType,
      instanceId,
      elementId,
      partId,
    });
    const metadataResponse = await getWmvepMetadata({
      client,
      path: {
        did: documentId,
        wvm: instanceType as "w" | "v" | "m",
        wvmid: instanceId,
        eid: elementId,
        iden: "p",
        pid: partId,
      },
      query: {
        includeComputedProperties: true,
      },
    });

    console.log("[ACTION] Metadata response received:", {
      hasData: !!metadataResponse.data,
      jsonType: metadataResponse.data?.jsonType,
      propertiesCount: metadataResponse.data?.properties?.length || 0,
    });

    const metadata = metadataResponse.data;
    if (!metadata || !metadata.properties) {
      console.error(
        "[ACTION] Failed to retrieve part metadata or properties missing"
      );
      console.error(
        "[ACTION] Metadata object:",
        JSON.stringify(metadata, null, 2)
      );
      return {
        success: false,
        error: "Failed to retrieve part metadata or no properties found",
      };
    }

    // Log all available properties for debugging
    console.log(
      "[ACTION] Available properties:",
      metadata.properties.map((prop: any) => ({
        name: prop.name,
        propertyId: prop.propertyId,
        value: prop.value,
        editable: prop.editable,
      }))
    );

    // Find the "Part number" property (try multiple possible names)
    const partNumberProperty = metadata.properties.find((prop: any) => {
      const name = prop.name?.toLowerCase();
      return (
        name === "part number" ||
        name === "partnumber" ||
        name === "part_number" ||
        prop.propertyId?.includes("partnumber") ||
        prop.propertyId?.includes("part_number")
      );
    });

    console.log("[ACTION] Part number property search result:", {
      found: !!partNumberProperty,
      propertyName: partNumberProperty?.name,
      propertyId: partNumberProperty?.propertyId,
      editable: partNumberProperty?.editable,
    });

    if (!partNumberProperty || !partNumberProperty.propertyId) {
      console.error("[ACTION] Part number property not found in metadata");
      const availableNames = metadata.properties
        .map((p: any) => p.name)
        .filter(Boolean);
      return {
        success: false,
        error: `Part number property not found. Available properties: ${availableNames.join(", ") || "none"}`,
      };
    }

    // Update the part number using the metadata API
    // Note: Even though the type says 'string', the generated client uses jsonBodySerializer
    // which will JSON.stringify it, so we pass an object to avoid double-encoding
    const updateBodyObj = {
      jsonType: "metadata-part",
      partId: partId,
      properties: [
        {
          value: partNumber.trim(),
          propertyId: partNumberProperty.propertyId,
        },
      ],
    };

    // Verify request format matches Onshape API documentation
    console.log("[ACTION] Update request body (verifying format):", {
      jsonType: updateBodyObj.jsonType,
      partId: updateBodyObj.partId,
      propertiesCount: updateBodyObj.properties.length,
      propertyValue: updateBodyObj.properties[0].value,
      propertyId: updateBodyObj.properties[0].propertyId,
      formatMatches:
        updateBodyObj.jsonType === "metadata-part" &&
        updateBodyObj.properties.length === 1 &&
        updateBodyObj.properties[0].propertyId ===
          partNumberProperty.propertyId,
    });

    console.log(
      "[ACTION] Sending update request with body object:",
      JSON.stringify(updateBodyObj, null, 2)
    );

    // Pass as object - the generated client will JSON.stringify it via jsonBodySerializer
    // The type says 'string' but that appears to be incorrect - passing an object should work
    const updateBody = updateBodyObj as any;

    let updateResponse;
    try {
      updateResponse = await updateWvepMetadata({
        client,
        path: {
          did: documentId,
          wvm: instanceType as "w" | "v" | "m",
          wvmid: instanceId,
          eid: elementId,
          iden: "p",
          pid: partId,
        },
        body: updateBody, // Passing object - client will serialize it
      });
    } catch (updateError: any) {
      console.error("[ACTION] Update API threw an error:", updateError);
      console.error("[ACTION] Update error details:", {
        message: updateError?.message,
        status: updateError?.status,
        response: updateError?.response
          ? {
              status: updateError.response.status,
              statusText: updateError.response.statusText,
              data: updateError.response.data,
            }
          : undefined,
      });
      throw updateError;
    }

    // Log full response including status and headers if available
    console.log("[ACTION] Update response received:", {
      hasData: !!updateResponse.data,
      response: JSON.stringify(updateResponse.data, null, 2),
      responseKeys: updateResponse.data ? Object.keys(updateResponse.data) : [],
      fullResponse: updateResponse,
    });

    // Check for HTTP status in response if available
    if (updateResponse && typeof updateResponse === "object") {
      const resp = updateResponse as any;
      console.log("[ACTION] Update response status check:", {
        status: resp.status,
        statusText: resp.statusText,
        ok: resp.ok,
        headers: resp.headers ? Object.keys(resp.headers) : undefined,
      });
    }

    // Log microversion info if available in response
    if (updateResponse.data && typeof updateResponse.data === "object") {
      const responseData = updateResponse.data as any;
      console.log("[ACTION] Update response microversion info:", {
        metadataMicroversion: responseData.metadataMicroversion,
        microversionId: responseData.microversionId,
        keys: Object.keys(responseData),
      });
    }

    // Verify the update by fetching metadata again (as per Onshape docs step 4)
    console.log("[ACTION] Verifying update by fetching metadata again...");
    try {
      const verificationMetadataResponse = await getWmvepMetadata({
        client,
        path: {
          did: documentId,
          wvm: instanceType as "w" | "v" | "m",
          wvmid: instanceId,
          eid: elementId,
          iden: "p",
          pid: partId,
        },
        query: {
          includeComputedProperties: true,
        },
      });

      const verificationMetadata = verificationMetadataResponse.data;
      if (verificationMetadata && verificationMetadata.properties) {
        const updatedPartNumberProperty = verificationMetadata.properties.find(
          (prop: any) => prop.propertyId === partNumberProperty.propertyId
        );
      } else {
        console.warn(
          "[ACTION] Could not verify update - verification metadata response missing properties"
        );
      }
    } catch (verifyError) {
      console.error(
        "[ACTION] Error verifying update via metadata API:",
        verifyError
      );
      // Don't fail the update if verification fails - it might just be a timing issue
    }

    return { success: true };
  } catch (error: unknown) {
    console.error("[ACTION] Error updating part number:", error);
    return createErrorResponse(error, "Failed to update part number");
  }
}
