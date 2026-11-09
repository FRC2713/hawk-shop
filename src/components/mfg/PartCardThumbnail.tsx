import { useState } from "react";
import { onshapeThumbnailSrc } from "~/lib/api/onshape";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";

interface PartCardThumbnailProps {
  part: BtPartMetadataInfo;
  /** The Part Studio the part was read from; keys the image by microversion. */
  scope?: { documentId?: string; elementId?: string };
}

/**
 * Component to display part thumbnail with error handling
 */
export function PartCardThumbnail({ part, scope }: PartCardThumbnailProps) {
  // Always prefer 300x300 thumbnail from sizes array
  // The main href is just a JSON link, not an image
  const rawThumbnailUrl =
    part.thumbnailInfo?.sizes?.find((s) => s.size === "300x300")?.href ||
    part.thumbnailInfo?.sizes?.[0]?.href ||
    part.thumbnailInfo?.sizes?.find((s) => s.size === "600x340")?.href;

  // Use proxy endpoint for authenticated thumbnail access
  const thumbnailHref = rawThumbnailUrl
    ? onshapeThumbnailSrc(rawThumbnailUrl, {
        documentId: scope?.documentId,
        elementId: scope?.elementId,
        partId: part.partId,
        microversionId: part.microversionId,
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
