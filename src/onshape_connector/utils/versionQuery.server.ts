import "virtual:hawk-shop/server-only";
import type { BtVersionInfo } from "~/lib/onshapeApi/generated-wrapper";
import { VERSION_TTL_MS, cacheKey } from "~/lib/onshapeApi/cache";
import { onshapeRead } from "~/lib/onshapeApi/gateway";

/**
 * Read one Onshape version through the gateway.
 *
 * A version is frozen once cut, so the answer is cached for a week and shared
 * by the version route, release and card snapshot backfill. A failed read (a
 * 404 is usually a key problem) throws and is never cached, so it cannot hide
 * the version for the whole week.
 */
export async function fetchVersionFromOnshape(
  documentId: string,
  versionId: string
): Promise<BtVersionInfo> {
  return onshapeRead<BtVersionInfo>({
    label: "version",
    cache: {
      key: cacheKey("version", documentId, versionId),
      ttlMs: VERSION_TTL_MS,
    },
    request: {
      path: `/v12/documents/d/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`,
    },
  });
}
