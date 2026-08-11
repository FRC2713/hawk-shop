import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "~/lib/db/client";
import { processes as processesTable } from "~/lib/db/schema";
import type { ProcessInsert, ProcessRow, ProcessUpdate } from "~/lib/db/types";

/**
 * Result type for getProcesses to distinguish errors from empty results
 */
export interface GetProcessesResult {
  processes: ProcessRow[];
  error?: string;
}

/**
 * Get all processes, alphabetically.
 * Returns both processes and potential error for proper error handling
 */
export async function getProcesses(): Promise<GetProcessesResult> {
  try {
    const processes = await db
      .select()
      .from(processesTable)
      .orderBy(asc(processesTable.name));

    return { processes };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error fetching processes";
    console.error("[PROCESSES] Error fetching processes:", message);
    return { processes: [], error: message };
  }
}

/**
 * Get a single process by ID
 */
export async function getProcessById(id: string): Promise<ProcessRow | null> {
  try {
    const [process] = await db
      .select()
      .from(processesTable)
      .where(eq(processesTable.id, id))
      .limit(1);

    return process ?? null;
  } catch (error) {
    console.error("[PROCESSES] Error fetching process:", error);
    throw error;
  }
}

/**
 * Create a new process
 */
export async function createProcess(
  processData: ProcessInsert
): Promise<ProcessRow> {
  const now = new Date().toISOString();
  const processId =
    processData.id ||
    `process-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  try {
    const [process] = await db
      .insert(processesTable)
      .values({
        id: processId,
        name: processData.name,
        description: processData.description ?? null,
        created_at: now,
        updated_at: now,
      })
      .returning();

    return process;
  } catch (error) {
    console.error("[PROCESSES] Error creating process:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to create process: ${message}`);
  }
}

/**
 * Update an existing process
 */
export async function updateProcess(
  processId: string,
  updates: ProcessUpdate
): Promise<ProcessRow> {
  let process: ProcessRow | undefined;
  try {
    [process] = await db
      .update(processesTable)
      .set({ ...updates, updated_at: new Date().toISOString() })
      .where(eq(processesTable.id, processId))
      .returning();
  } catch (error) {
    console.error("[PROCESSES] Error updating process:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to update process: ${message}`);
  }

  if (!process) {
    throw new Error("Process not found");
  }

  return process;
}

/**
 * Delete a process. The junction-table rows cascade away with it.
 */
export async function deleteProcess(processId: string): Promise<ProcessRow> {
  let process: ProcessRow | undefined;
  try {
    [process] = await db
      .delete(processesTable)
      .where(eq(processesTable.id, processId))
      .returning();
  } catch (error) {
    console.error("[PROCESSES] Error deleting process:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Failed to delete process: ${message}`);
  }

  if (!process) {
    throw new Error("Process not found");
  }

  return process;
}
