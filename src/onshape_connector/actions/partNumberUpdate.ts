import "virtual:hawk-shop/server-only";
import { cacheKey, invalidateOnshapeCache } from "~/lib/onshapeApi/cache";
import { isOnshapeConfigured } from "~/lib/onshapeApi/auth";
import {
  onshapeOperation,
  onshapeRead,
  OnshapeRequestError,
  onshapeWrite,
  type OnshapeRequest,
} from "~/lib/onshapeApi/gateway";
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

/** A non-OK Onshape answer as an action failure that keeps Onshape's reason. */
function rejection(error: unknown, message: string): ActionResponse | null {
  if (!(error instanceof OnshapeRequestError)) return null;
  return createErrorResponse(
    { error: { message: error.detail || message }, status: error.status },
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
  if (!isOnshapeConfigured()) {
    return { success: false, error: "Onshape API access is not configured." };
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

    const metadataPath = `/v12/metadata/d/${encodeURIComponent(documentId)}/${encodeURIComponent(instanceType)}/${encodeURIComponent(instanceId)}/e/${encodeURIComponent(elementId)}/p/${encodeURIComponent(partId)}`;
    const readMetadata = (step: string) =>
      onshapeRead<unknown>({
        label: "metadata-read",
        // Each step must see Onshape's current answer, never a shared one.
        dedupKey: `metadata-read::${step}::${crypto.randomUUID()}`,
        request: {
          path: metadataPath,
          query: { includeComputedProperties: true },
        } satisfies OnshapeRequest,
      });

    // The daily ceiling is checked once, here: a write already past its
    // discovery read finishes, so Onshape and the card never disagree.
    return await onshapeOperation(async () => {
      let discovered: unknown;
      try {
        discovered = await readMetadata("discovery");
      } catch (error: unknown) {
        const failure = rejection(error, "Failed to retrieve part metadata");
        if (failure) return failure;
        throw error;
      }
      const properties = propertiesFrom(discovered);
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

      try {
        // The write body is unused. Discarding it means decoding or stream
        // errors cannot hide acceptance or prevent eviction and verification.
        await onshapeWrite({
          label: "metadata-write",
          responseType: "none",
          request: {
            path: metadataPath,
            body: {
              jsonType: "metadata-part",
              partId,
              properties: [
                { value: partNumber, propertyId: property.propertyId },
              ],
            },
          },
        });
      } catch (error: unknown) {
        const failure = rejection(
          error,
          "Onshape rejected the part number update"
        );
        if (failure) return failure;
        throw error;
      }
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
        const verified = await readMetadata("verification");
        const updatedProperty = propertiesFrom(verified)?.find(
          (candidate) => candidate.propertyId === property.propertyId
        );
        if (updatedProperty?.value !== partNumber) {
          return unconfirmed(
            "Verification did not return the requested part number."
          );
        }
      } catch (error: unknown) {
        if (error instanceof OnshapeRequestError)
          return unconfirmed(
            `Verification metadata request failed: ${error.detail || `status ${error.status}`}.`
          );
        console.error("[ACTION] Error verifying part number update:", error);
        return unconfirmed("The verification request failed.");
      }
      return { success: true } satisfies ActionResponse;
    });
  } catch (error: unknown) {
    return createErrorResponse(error, "Failed to update part number");
  }
}
