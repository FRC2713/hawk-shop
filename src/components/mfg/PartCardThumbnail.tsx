import { useState } from "react";
import {
  partMicroversionOf,
  partThumbnailHref,
  thumbnailProxyUrl,
  type OnshapePartsScope,
} from "~/lib/api/onshape";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";

interface PartCardThumbnailProps {
  part: BtPartMetadataInfo;
  /** The Part Studio the part was read from; keys the image by microversion. */
  scope?: Partial<Pick<OnshapePartsScope, "documentId" | "elementId">>;
}

/**
 * Component to display part thumbnail with error handling
 */
export function PartCardThumbnail({ part, scope }: PartCardThumbnailProps) {
  // The main href is just a JSON link, not an image
  const rawThumbnailUrl = partThumbnailHref(part);

  // Use proxy endpoint for authenticated thumbnail access
  const thumbnailHref = rawThumbnailUrl
    ? thumbnailProxyUrl({
        url: rawThumbnailUrl,
        part: partMicroversionOf(scope, part),
      })
    : null;

  const [thumbnailError, setThumbnailError] = useState(false);

  if (!thumbnailHref || thumbnailError) {
    return null;
  }

  return (
    <div className="px-6 pb-4">
      <div className="relative w-full" style={{ height: "300px" }}>
        <img
          src={thumbnailHref}
          alt={`Thumbnail for ${part.name || part.partId || part.id || "part"}`}
          className="absolute inset-0 size-full object-contain"
          onError={() => setThumbnailError(true)}
        />
      </div>
    </div>
  );
}
