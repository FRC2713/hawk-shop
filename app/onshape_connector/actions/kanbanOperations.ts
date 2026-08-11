import { z } from "zod";
import { createCard, updateCard } from "~/lib/kanbanApi/cards";
import { logger } from "~/lib/logger";
import { onshapeApiRequest } from "~/lib/onshapeApi/auth";
import { getValidOnshapeTokenFromRequest } from "~/lib/tokenRefresh";
import type { ActionResponse } from "../utils/types";
import { extractVersionId } from "../utils/versionUtils";
import type { PartsPageSearchParams } from "../utils/types";

/**
 * Onshape user response from /users/current endpoint
 */
interface OnshapeUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  name?: string;
}

/**
 * Zod schema for adding a card to the Kanban board
 */
const addCardSchema = z.object({
  partNumber: z.string().min(1, "Part number is required"),
  documentId: z.string().optional(),
  instanceType: z.string().default("w"),
  instanceId: z.string().optional(),
  elementId: z.string().optional(),
  partId: z.string().optional(),
  rawThumbnailUrl: z.string().optional(),
  processIds: z.array(z.string()).min(1, "At least one process is required"),
  quantityPerRobot: z
    .string()
    .min(1, "Quantity per robot is required")
    .transform((val) => Number(val))
    .pipe(z.number().positive("Quantity per robot must be greater than 0")),
  quantityToMake: z
    .string()
    .min(1, "Quantity to make is required")
    .transform((val) => Number(val))
    .pipe(z.number().positive("Quantity to make must be greater than 0")),
  dueDate: z.string().optional(),
});

/**
 * Zod schema for moving a card between columns
 */
const moveCardSchema = z.object({
  cardId: z.string().min(1, "Card ID is required"),
  columnId: z.string().min(1, "Column ID is required"),
});

/**
 * Zod schema for updating a card's due date
 */
const updateDueDateSchema = z.object({
  cardId: z.string().min(1, "Card ID is required"),
  dueDate: z.string().optional(),
});

/**
 * Extract string value from FormData safely
 * Returns undefined for File entries or null values
 */
function getStringValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (value === null || value instanceof File) {
    return undefined;
  }
  return value;
}

/**
 * Parse FormData into an object for Zod validation
 * Handles arrays for keys that should be collected as arrays
 */
function formDataToObject(
  formData: FormData,
  keys: string[],
  arrayKeys: string[] = []
): Record<string, string | string[] | undefined> {
  const obj: Record<string, string | string[] | undefined> = {};
  for (const key of keys) {
    if (arrayKeys.includes(key)) {
      // Collect all values for array keys
      const values = formData.getAll(key);
      obj[key] = values.length > 0 ? (values as string[]) : undefined;
    } else {
      obj[key] = getStringValue(formData, key);
    }
  }
  return obj;
}

/**
 * Fetch current user ID from Onshape API
 * Returns the Onshape user ID to be stored in created_by field
 */
async function fetchOnshapeUserId(
  request: Request
): Promise<string | undefined> {
  try {
    const accessToken = await getValidOnshapeTokenFromRequest(request);

    if (!accessToken) {
      logger.debug("[Kanban] No access token available");
      return undefined;
    }

    const response = await onshapeApiRequest(accessToken, "/users/current");

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => "Unable to read error");
      logger.error(
        `[Kanban] API response not OK. Status: ${response.status}, Error: ${errorText}`
      );
      return undefined;
    }

    const user = (await response.json()) as OnshapeUser;
    logger.debug("[Kanban] User data received");

    // Return the Onshape user ID
    return user.id;
  } catch (error) {
    logger.error("[Kanban] Error fetching user info:", error);
    return undefined;
  }
}

/**
 * Handle adding a card to the Kanban board
 */
export async function handleAddKanbanCard(
  formData: FormData,
  request: Request
): Promise<ActionResponse> {
  // Parse and validate form data
  const rawData = formDataToObject(
    formData,
    [
      "partNumber",
      "documentId",
      "instanceType",
      "instanceId",
      "elementId",
      "partId",
      "rawThumbnailUrl",
      "processIds",
      "quantityPerRobot",
      "quantityToMake",
      "dueDate",
    ],
    ["processIds"]
  );

  // Convert processIds array to proper format for schema
  const processedData = {
    ...rawData,
    processIds: Array.isArray(rawData.processIds)
      ? rawData.processIds
      : rawData.processIds
        ? [rawData.processIds]
        : [],
    quantityPerRobot:
      typeof rawData.quantityPerRobot === "string"
        ? rawData.quantityPerRobot
        : "",
    quantityToMake:
      typeof rawData.quantityToMake === "string" ? rawData.quantityToMake : "",
  };

  const parseResult = addCardSchema.safeParse(processedData);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues
      .map((issue) => issue.message)
      .join(", ");
    return { success: false, error: errorMessage };
  }

  const data = parseResult.data;

  try {
    // Extract version ID from the instance type and ID
    // Build query params object for version extraction
    const queryParams: PartsPageSearchParams = {
      documentId: data.documentId || "",
      instanceType: (data.instanceType as "w" | "v" | "m") || "w",
      instanceId: data.instanceId || "",
      elementId: data.elementId || "",
      elementType: "PARTSTUDIO", // Default, not used for version extraction
    };
    const versionId = extractVersionId(queryParams);

    // Build image URL from raw thumbnail URL (same strategy as PartCardThumbnail)
    // Ensure thumbnail uses version-specific parameters if we need to rebuild it
    let imageUrl = "";
    if (data.rawThumbnailUrl) {
      // Use proxy endpoint for authenticated thumbnail access
      // The rawThumbnailUrl from Onshape is already version-specific since it comes
      // from the parts query which uses the version-specific instanceId
      imageUrl = `/api/onshape/thumbnail?url=${encodeURIComponent(data.rawThumbnailUrl)}`;
    } else if (
      data.documentId &&
      data.instanceId &&
      data.elementId &&
      data.partId
    ) {
      // Fallback: build thumbnail URL using version-specific parameters
      const wvm =
        data.instanceType === "w" ? "w" : data.instanceType === "v" ? "v" : "m";
      const thumbnailUrl = `https://cad.onshape.com/api/v10/thumbnails/d/${data.documentId}/${wvm}/${data.instanceId}/e/${data.elementId}/p/${encodeURIComponent(data.partId)}?outputFormat=PNG&pixelSize=300`;
      imageUrl = `/api/onshape/thumbnail?url=${encodeURIComponent(thumbnailUrl)}`;
    }

    // Get Onshape user ID to store in created_by field
    const createdBy = await fetchOnshapeUserId(request);

    // Create card with version ID
    // Keep title as just partNumber - matching will use composite key (partNumber::versionId)
    const card = await createCard({
      title: data.partNumber,
      imageUrl,
      assignee: "Unassigned",
      machine: "TBD",
      createdBy,
      processIds: data.processIds,
      quantityPerRobot: data.quantityPerRobot,
      quantityToMake: data.quantityToMake,
      dueDate: data.dueDate,
      onshapeDocumentId: data.documentId,
      onshapeInstanceType: data.instanceType,
      onshapeInstanceId: data.instanceId,
      onshapeElementId: data.elementId,
      onshapePartId: data.partId,
      onshapeVersionId: versionId,
    });

    return { success: true, data: card };
  } catch (error) {
    logger.error("[Kanban] Error adding card:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to add card to tracker",
    };
  }
}

/**
 * Handle moving a card between columns
 */
export async function handleMoveKanbanCard(
  formData: FormData
): Promise<ActionResponse> {
  // Parse and validate form data
  const rawData = formDataToObject(formData, ["cardId", "columnId"]);

  const parseResult = moveCardSchema.safeParse(rawData);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues
      .map((issue) => issue.message)
      .join(", ");
    return { success: false, error: errorMessage };
  }

  const { cardId, columnId } = parseResult.data;

  try {
    const card = await updateCard(cardId, { column_id: columnId });
    return { success: true, data: card };
  } catch (error) {
    logger.error("[Kanban] Error moving card:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to move card",
    };
  }
}

/**
 * Handle updating a card's due date
 */
export async function handleUpdateKanbanDueDate(
  formData: FormData
): Promise<ActionResponse> {
  // Parse and validate form data
  const rawData = formDataToObject(formData, ["cardId", "dueDate"]);

  const parseResult = updateDueDateSchema.safeParse(rawData);
  if (!parseResult.success) {
    const errorMessage = parseResult.error.issues
      .map((issue) => issue.message)
      .join(", ");
    return { success: false, error: errorMessage };
  }

  const { cardId, dueDate } = parseResult.data;

  try {
    const card = await updateCard(cardId, {
      due_date: dueDate || undefined,
    });
    return { success: true, data: card };
  } catch (error) {
    logger.error("[Kanban] Error updating due date:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update due date",
    };
  }
}
