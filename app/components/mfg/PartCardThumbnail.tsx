import { useState } from "react";
import Image from "next/image";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";

interface PartCardThumbnailProps {
  part: BtPartMetadataInfo;
}

/**
 * Component to display part thumbnail with error handling
 */
export function PartCardThumbnail({ part }: PartCardThumbnailProps) {
  // Always prefer 300x300 thumbnail from sizes array
  // The main href is just a JSON link, not an image
  const rawThumbnailUrl =
    part.thumbnailInfo?.sizes?.find((s) => s.size === "300x300")?.href ||
    part.thumbnailInfo?.sizes?.[0]?.href ||
    part.thumbnailInfo?.sizes?.find((s) => s.size === "600x340")?.href;

  // Use proxy endpoint for authenticated thumbnail access
  const thumbnailHref = rawThumbnailUrl
    ? `/api/onshape/thumbnail?url=${encodeURIComponent(rawThumbnailUrl)}`
    : null;

  const [thumbnailError, setThumbnailError] = useState(false);

  if (!thumbnailHref || thumbnailError) {
    return null;
  }

  return (
    <div className="px-6 pb-4">
      <div className="relative w-full" style={{ height: "300px" }}>
        <Image
          src={thumbnailHref}
          alt={`Thumbnail for ${part.name || part.partId || part.id || "part"}`}
          fill
          className="object-contain"
          onError={() => setThumbnailError(true)}
          unoptimized
        />
      </div>
    </div>
  );
}
