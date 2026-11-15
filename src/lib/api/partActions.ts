import { ApiError, redirectToSignIn } from "./client";
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./keys";
import type { ActionResponse } from "~/onshape_connector/utils/types";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";

/**
 * `/api/mfg/parts/actions` — the one endpoint that does not go through
 * `apiFetch`.
 *
 * It answers a rejected operation with HTTP 400 *and* a `{ success: false,
 * error }` body, and the UI wants that body: the error is a validation message
 * to show inline, not a transport failure. So the status is ignored and the
 * body is the contract.
 *
 * What is still worth guarding is the content type. The auth middleware can
 * answer a signed-out request with an HTML redirect, and `response.json()` on
 * that throws something unreadable; failing loudly with the status is clearer.
 */
async function postAction(body: FormData): Promise<ActionResponse> {
  const response = await fetch("/api/mfg/parts/actions", {
    method: "POST",
    body,
  });

  if (response.status === 401) {
    redirectToSignIn();
    throw new Error("Sign in with Hawk Suite to continue.");
  }
  const contentType = response.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    throw new Error(
      `Expected JSON from /api/mfg/parts/actions but got ${contentType ?? "no content-type"} (status ${response.status})`
    );
  }

  return (await response.json()) as ActionResponse;
}

/** The Onshape coordinates of the part a card is being created from. */
export interface OnshapePartRef {
  documentId: string;
  instanceType: string;
  instanceId: string;
  elementId: string;
  partId: string;
}

export interface AddCardInput {
  partNumber: string;
  processIds: string[];
  projectId: string;
  quantityToMake: number | string;
  /** ISO `yyyy-MM-dd`; omitted means no due date. */
  dueDate?: string;
  onshapePart?: OnshapePartRef;
  /** The part's microversion from the parts read being released from. */
  microversionId?: string;
  rawThumbnailUrl?: string;
}

export function addCard(input: AddCardInput): Promise<ActionResponse> {
  const body = new FormData();
  body.append("action", "addCard");
  body.append("partNumber", input.partNumber);
  input.processIds.forEach((id) => body.append("processIds", id));
  body.append("projectId", input.projectId);
  body.append("quantityToMake", String(input.quantityToMake));
  if (input.dueDate) body.append("dueDate", input.dueDate);
  if (input.onshapePart) {
    for (const [key, value] of Object.entries(input.onshapePart)) {
      body.append(key, value);
    }
  }
  if (input.microversionId) {
    body.append("microversionId", input.microversionId);
  }
  if (input.rawThumbnailUrl) {
    body.append("rawThumbnailUrl", input.rawThumbnailUrl);
  }
  return postAction(body);
}

/**
 * Unlike the others this rejects on failure: its caller drives an optimistic
 * board update and needs a rejected promise to roll back on.
 */
export async function moveCard(
  cardId: string,
  columnId: string
): Promise<ActionResponse> {
  const body = new FormData();
  body.append("action", "moveCard");
  body.append("cardId", cardId);
  body.append("columnId", columnId);

  const result = await postAction(body);
  if (!result.success) {
    throw new ApiError(
      result.error || "Failed to move card",
      400,
      "/api/mfg/parts/actions",
      result.errorId
    );
  }
  return result;
}

/** An empty `dueDate` clears the date. */
export function updateDueDate(
  cardId: string,
  dueDate: string
): Promise<ActionResponse> {
  const body = new FormData();
  body.append("action", "updateDueDate");
  body.append("cardId", cardId);
  body.append("dueDate", dueDate);
  return postAction(body);
}

export interface UpdatePartNumberInput {
  partId: string;
  partNumber: string;
  documentId: string;
  instanceType: string;
  instanceId: string;
  elementId: string;
}

export async function updatePartNumber(
  input: UpdatePartNumberInput,
  queryClient: QueryClient
): Promise<ActionResponse> {
  const body = new FormData();
  for (const [key, value] of Object.entries(input)) {
    body.append(key, value);
  }
  const result = await postAction(body);
  if (result.success) {
    // Both thumbnail variants share this Part Studio prefix. The server has
    // already applied the confirmed number to its cached read, so the edit is
    // applied here too instead of refetching. Query failures here do not
    // reject the accepted edit or trigger another write.
    const affectedParts = { queryKey: queryKeys.onshape.partsScope(input) };
    // A fetch already in flight may carry the old number: stop it so its
    // answer cannot land on top of the edit.
    await queryClient.cancelQueries(affectedParts);
    queryClient.setQueriesData<BtPartMetadataInfo[]>(affectedParts, (parts) =>
      parts?.map((part) =>
        part.partId === input.partId
          ? { ...part, partNumber: input.partNumber }
          : part
      )
    );
    // A query still loading its first answer has nothing to patch; it asks
    // Hawk Shop again, whose cached read already carries the edit.
    await queryClient.invalidateQueries({
      ...affectedParts,
      predicate: (query) => query.state.data === undefined,
    });
  }
  return result;
}
