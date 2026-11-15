import "virtual:hawk-shop/server-only";
import {
  isOnshapeConfigured,
  OnshapeDailyBudgetError,
} from "~/lib/onshapeApi/auth";
import {
  onshapeOperation,
  onshapeRead,
  OnshapeRequestError,
  onshapeWrite,
  type OnshapeRequest,
} from "~/lib/onshapeApi/gateway";
import {
  isPartNumberProperty,
  partStudioFreshness,
} from "~/lib/onshapeApi/partStudioFreshness";
import { createErrorResponse } from "../utils/errorHandling";
import type { ActionResponse } from "../utils/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function propertiesFrom(metadata: unknown) {
  if (!isRecord(metadata) || !Array.isArray(metadata.properties)) return null;
  return metadata.properties.filter(isRecord);
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
    const readMetadata = () =>
      onshapeRead<unknown>({
        label: "metadata-read",
        // Each step must see Onshape's current answer, never a shared one.
        singleFlight: false,
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
        discovered = await readMetadata();
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
      const partStudio = { documentId, instanceType, instanceId, elementId };
      // Onshape accepted the write: apply it to the cached parts read rather
      // than discarding it, so the connector shows the number without another
      // parts read. If verification then disagrees, the read is discarded.
      try {
        partStudioFreshness.wrote(partStudio, partId, { partNumber });
      } catch (error: unknown) {
        console.error(
          "[ACTION] Error updating cached parts after accepted write:",
          error
        );
        try {
          partStudioFreshness.discard(partStudio);
        } catch {
          // Already reported; the unconfirmed answer below covers it.
        }
        return unconfirmed("The parts cache could not be refreshed.");
      }

      const failure = await (async () => {
        try {
          const verified = await readMetadata();
          const updatedProperty = propertiesFrom(verified)?.find(
            (candidate) => candidate.propertyId === property.propertyId
          );
          if (updatedProperty?.value !== partNumber)
            return unconfirmed(
              "Verification did not return the requested part number."
            );
          return null;
        } catch (error: unknown) {
          if (error instanceof OnshapeRequestError)
            return unconfirmed(
              `Verification metadata request failed: ${error.detail || `status ${error.status}`}.`
            );
          console.error("[ACTION] Error verifying part number update:", error);
          return unconfirmed("The verification request failed.");
        }
      })();
      if (failure) {
        try {
          partStudioFreshness.discard(partStudio);
        } catch (error: unknown) {
          console.error("[ACTION] Error discarding unconfirmed parts:", error);
        }
        return failure;
      }
      return { success: true } satisfies ActionResponse;
    });
  } catch (error: unknown) {
    // The ceiling is a known state, not a fault: answer like the other
    // Onshape routes and log nothing.
    if (error instanceof OnshapeDailyBudgetError)
      return { success: false, error: error.message, status: 503 };
    return createErrorResponse(error, "Failed to update part number");
  }
}
