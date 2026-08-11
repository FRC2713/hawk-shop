import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface ImagePreviewProps {
  imageUrl: string;
  onDelete?: () => void;
  onClick?: () => void;
  className?: string;
  showDelete?: boolean;
}

export function ImagePreview({
  imageUrl,
  onDelete,
  onClick,
  className,
  showDelete = true,
}: ImagePreviewProps) {
  return (
    <div
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg border",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      <img
        src={imageUrl}
        alt="Preview"
        className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-105"
      />
      {showDelete && onDelete && (
        <Button
          variant="destructive"
          size="icon"
          className="absolute top-2 right-2 size-6 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}
