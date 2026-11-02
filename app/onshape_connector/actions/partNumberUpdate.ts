import "@tanstack/react-start/server-only";
import {
  createOnshapeApiClientFromRequest,
  getWmvepMetadata,
  updateWvepMetadata,
} from "~/lib/onshapeApi/generated-wrapper";
import {
  cacheKey,
  invalidateOnshapeCache,
  recordOnshapeUsage,
} from "~/lib/onshapeApi/cache";
import { isOnshapeAuthenticatedFromRequest } from "~/lib/onshapeAuth";
import { createErrorResponse } from "../utils/errorHandling";
import type { ActionResponse } from "../utils/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propertiesFrom(metadata: unknown) {
  if (!isRecord(metadata) || !Array.isArray(metadata.properties)) return null;
  return metadata.properties.filter(isRecord);
}

function isPartNumberProperty(property: Record<string, unknown>) {
  const name =
    typeof property.name === "string" ? property.name.toLowerCase() : "";
  const id = typeof property.propertyId === "string" ? property.propertyId : "";
  return (
    name === "part number" ||
    name === "partnumber" ||
    name === "part_number" ||
    id.includes("partnumber") ||
    id.includes("part_number")
  );
}

function upstreamFailure(
  result: { error?: unknown; response: Response },
  message: string
): ActionResponse | null {
  if (result.error === undefined && result.response.ok) return null;
  return createErrorResponse(
    {
      error:
        typeof result.error === "string"
          ? { message: result.error }
          : result.error,
      status: result.response.status,
    },
    message
  );
}

function unconfirmed(reason: string): ActionResponse {
  return {
    success: false,
    error: `The part number write may have succeeded but could not be confirmed. ${reason} Check the part in Onshape before retrying.`,
  };
}

/** Discover, write, and verify metadata using only the initiating request's identity. */
export async function handlePartNumberUpdate(
  formData: FormData,
  request: Request
): Promise<ActionResponse> {
  if (!isOnshapeAuthenticatedFromRequest(request)) {
    return { success: false, error: "Not authenticated with Onshape" };
  }

  try {
    const partId = formData.get("partId")?.toString();
    const partNumber = formData.get("partNumber")?.toString().trim();
    const documentId = formData.get("documentId")?.toString();
    const instanceType = formData.get("instanceType")?.toString() || "w";
    const instanceId = formData.get("instanceId")?.toString();
    const elementId = formData.get("elementId")?.toString();
    if (!partId || !partNumber || !documentId || !instanceId || !elementId) {
      const missing = Object.entries({
        partId,
        partNumber,
        documentId,
        instanceId,
        elementId,
      })
        .filter(([, value]) => !value)
        .map(([key]) => key);
      return {
        success: false,
        error: `Missing required fields: ${missing.join(", ")}`,
      };
    }

    const client = await createOnshapeApiClientFromRequest(request);
    // Count successful HTTP traffic before the generated decoder runs, even
    // when a metadata response contains invalid JSON.
    client.interceptors.response.use((response) => {
      if (response.ok) recordOnshapeUsage("metadata", "call");
      return response;
    });
    const path = {
      did: documentId,
      wvm: instanceType as "w" | "v" | "m",
      wvmid: instanceId,
      eid: elementId,
      iden: "p" as const,
      pid: partId,
    };
    const metadataResponse = await getWmvepMetadata({
      client,
      path,
      query: { includeComputedProperties: true },
    });
    const metadataFailure = upstreamFailure(
      metadataResponse,
      "Failed to retrieve part metadata"
    );
    if (metadataFailure) return metadataFailure;
    const properties = propertiesFrom(metadataResponse.data);
    if (!properties) {
      return {
        success: false,
        error:
          "Failed to retrieve part metadata: properties are missing or malformed",
      };
    }
    const property = properties.find(isPartNumberProperty);
    if (
      !property ||
      typeof property.propertyId !== "string" ||
      !property.propertyId.trim()
    ) {
      return {
        success: false,
        error: "Part number property not found or malformed in part metadata",
      };
    }

    // The generated schema calls this body a string. Its JSON serializer needs
    // the object itself; a pre-serialized string would be encoded twice.
    const body = {
      jsonType: "metadata-part",
      partId,
      properties: [{ value: partNumber, propertyId: property.propertyId }],
    } as unknown as string;
    // The write body is unused. Do not consume it: decoding or stream errors
    // must not hide acceptance or prevent eviction and independent verification.
    const updateResponse = await updateWvepMetadata({
      client,
      path,
      body,
      parseAs: "stream",
    });
    const writeFailure = upstreamFailure(
      updateResponse,
      "Onshape rejected the part number update"
    );
    if (writeFailure) return writeFailure;
    // Release the unused body without making confirmation depend on its stream.
    void updateResponse.response.body?.cancel().catch(() => {});
    try {
      invalidateOnshapeCache(
        cacheKey("parts", documentId, instanceType, instanceId, elementId)
      );
    } catch (error: unknown) {
      console.error(
        "[ACTION] Error invalidating parts after accepted write:",
        error
      );
      return unconfirmed("The parts cache could not be refreshed.");
    }

    try {
      const verification = await getWmvepMetadata({
        client,
        path,
        query: { includeComputedProperties: true },
      });
      const failure = upstreamFailure(
        verification,
        "Verification metadata request failed"
      );
      if (failure) return unconfirmed(`${failure.error}.`);
      const updatedProperty = propertiesFrom(verification.data)?.find(
        (candidate) => candidate.propertyId === property.propertyId
      );
      if (updatedProperty?.value !== partNumber) {
        return unconfirmed(
          "Verification did not return the requested part number."
        );
      }
    } catch (error: unknown) {
      console.error("[ACTION] Error verifying part number update:", error);
      return unconfirmed("The verification request failed.");
    }
    return { success: true };
  } catch (error: unknown) {
    console.error("[ACTION] Error updating part number:", error);
    return createErrorResponse(error, "Failed to update part number");
  }
}
