/**
 * Onshape API Client
 * Documentation: https://onshape-public.github.io/docs/
 */

import {
  getValidOnshapeTokenFromRequest,
  getOnshapeTokenWithoutRefresh,
} from "../tokenRefresh";
import { onshapeApiRequest } from "./auth";

export interface OnshapeUser {
  id: string;
  name: string;
  email?: string;
  href: string;
}

export interface OnshapeDocument {
  id: string;
  name: string;
  href: string;
  owner?: {
    id: string;
    name: string;
    href: string;
  };
  createdBy?: {
    id: string;
    name: string;
    href: string;
  };
  modifiedAt?: string;
  thumbnail?: {
    href: string;
  };
}

export interface OnshapeError {
  message: string;
  status: number;
  reason?: string;
}

export interface OnshapePart {
  partId: string;
  name?: string;
  bodyType?: string;
  appearance?: {
    color?: [number, number, number, number];
    opacity?: number;
  };
  isHidden?: boolean;
  isMesh?: boolean;
  microversionId?: string;
  thumbnail?: {
    href?: string;
    [key: string]: unknown; // Allow other thumbnail properties
  };
  [key: string]: unknown; // Allow other properties from API response
}

/**
 * Onshape API Client
 */
export class OnshapeClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Make a request to the Onshape API
   */
  private async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await onshapeApiRequest(
      this.accessToken,
      endpoint,
      options
    );

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.message || errorData.error || errorData.errorMessage) {
          errorMessage =
            errorData.message || errorData.error || errorData.errorMessage;
        }
      } catch {
        // If response isn't JSON, use default message
      }

      throw {
        message: errorMessage,
        status: response.status,
      } as OnshapeError;
    }

    const contentType = response.headers.get("Content-Type");
    if (contentType?.includes("application/json")) {
      return await response.json();
    } else {
      return (await response.text()) as unknown as T;
    }
  }

  /**
   * GET request
   */
  async get<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "GET" });
  }

  /**
   * POST request
   */
  async post<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * PUT request
   */
  async put<T = unknown>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * DELETE request
   */
  async delete<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  /**
   * Get current logged-in user information
   */
  async getCurrentUser(): Promise<OnshapeUser> {
    return this.get<OnshapeUser>("/users/sessioninfo");
  }

  /**
   * Get document details by document ID
   */
  async getDocumentDetails(documentId: string): Promise<OnshapeDocument> {
    return this.get<OnshapeDocument>(`/documents/${documentId}`);
  }

  /**
   * Get all documents accessible to the user
   */
  async getDocuments(): Promise<OnshapeDocument[]> {
    const response = await this.get<{ items: OnshapeDocument[] }>("/documents");
    return response.items || [];
  }

  /**
   * Get all parts from a Part Studio
   * @param did Document ID
   * @param wvm Workspace/Version/Microversion type ("w" for workspace, "v" for version, "m" for microversion)
   * @param wvmid Workspace/Version/Microversion ID
   * @param eid Element ID (Part Studio element)
   */
  async getParts(
    did: string,
    wvm: string,
    wvmid: string,
    eid: string
  ): Promise<OnshapePart[]> {
    const endpoint = `/partstudios/d/${did}/${wvm}/${wvmid}/e/${eid}/parts`;
    const response = await this.get<OnshapePart[] | { parts: OnshapePart[] }>(
      endpoint
    );
    // Handle both response formats: direct array or wrapped in { parts: [...] }
    if (Array.isArray(response)) {
      return response;
    }
    return (response as { parts: OnshapePart[] }).parts || [];
  }

  /**
   * Generate a thumbnail for an element
   * @param did Document ID
   * @param wvm Workspace/Version/Microversion type ("w" for workspace, "v" for version, "m" for microversion)
   * @param wvmid Workspace/Version/Microversion ID
   * @param eid Element ID
   */
  async generateThumbnail(
    did: string,
    wvm: string,
    wvmid: string,
    eid: string
  ): Promise<void> {
    const endpoint = `/thumbnails/d/${did}/${wvm}/${wvmid}/e/${eid}`;
    await this.post(endpoint);
  }
}

/**
 * Create an Onshape client with automatic token refresh
 * This should be used in server-side loaders/actions
 */
export async function createOnshapeClient(
  request: Request
): Promise<OnshapeClient> {
  const accessToken = await getValidOnshapeTokenFromRequest(request);
  if (!accessToken) {
    throw new Error("Not authenticated with Onshape");
  }
  return new OnshapeClient(accessToken);
}

/**
 * Create an Onshape client from tokens (for server components)
 * This should be used in server components where cookies are read-only
 * Token refresh happens in route handlers, not during render
 */
export async function createOnshapeClientFromTokens(): Promise<OnshapeClient | null> {
  const accessToken = await getOnshapeTokenWithoutRefresh();
  if (!accessToken) {
    return null;
  }
  return new OnshapeClient(accessToken);
}

/**
 * Get the current Onshape user from active tokens
 * Returns null if not authenticated or if the request fails
 * This should be used in server components
 */
export async function getCurrentOnshapeUser(): Promise<OnshapeUser | null> {
  try {
    const client = await createOnshapeClientFromTokens();
    if (!client) {
      return null;
    }
    return await client.getCurrentUser();
  } catch (error) {
    console.error("Error fetching current Onshape user:", error);
    return null;
  }
}
