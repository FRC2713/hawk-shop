import type { ActionResponse } from "~/onshape_connector/utils/types";

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
  quantityPerRobot: number | string;
  quantityToMake: number | string;
  /** ISO `yyyy-MM-dd`; omitted means no due date. */
  dueDate?: string;
  onshapePart?: OnshapePartRef;
  rawThumbnailUrl?: string;
}

export function addCard(input: AddCardInput): Promise<ActionResponse> {
  const body = new FormData();
  body.append("action", "addCard");
  body.append("partNumber", input.partNumber);
  input.processIds.forEach((id) => body.append("processIds", id));
  body.append("quantityPerRobot", String(input.quantityPerRobot));
  body.append("quantityToMake", String(input.quantityToMake));
  if (input.dueDate) body.append("dueDate", input.dueDate);
  if (input.onshapePart) {
    for (const [key, value] of Object.entries(input.onshapePart)) {
      body.append(key, value);
    }
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
    throw new Error(result.error || "Failed to move card");
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

export function updatePartNumber(
  input: UpdatePartNumberInput
): Promise<ActionResponse> {
  const body = new FormData();
  for (const [key, value] of Object.entries(input)) {
    body.append(key, value);
  }
  return postAction(body);
}
