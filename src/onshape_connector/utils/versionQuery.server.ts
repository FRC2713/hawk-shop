import "virtual:hawk-shop/server-only";
import { assertOnshapeAllocation } from "~/lib/onshapeApi/auth";
import {
  createOnshapeApiClient,
  getVersion,
} from "~/lib/onshapeApi/generated-wrapper";
import {
  VERSION_TTL_MS,
  cacheKey,
  withOnshapeCache,
} from "~/lib/onshapeApi/cache";

/**
 * Read one Onshape version through the shared server cache.
 *
 * A version is frozen once cut, so the answer is cached for a week and shared
 * by the version route, release and card snapshot backfill.
 */
export async function fetchVersionFromOnshape(
  documentId: string,
  versionId: string
) {
  return withOnshapeCache({
    label: "version",
    key: cacheKey("version", documentId, versionId),
    ttlMs: VERSION_TTL_MS,
    fetcher: async () => {
      const client = await createOnshapeApiClient();
      const response = await getVersion({
        client,
        path: { did: documentId, vid: versionId },
      });
      assertOnshapeAllocation(response.response);
      // Thrown rather than returned so the miss is not cached: a 404 here is
      // usually a token problem, and caching it for a week would hide the
      // version until the TTL lapsed.
      if (!response.data) throw new Error("Version not found");
      return response.data;
    },
  });
}
