import { Image as ImageIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface EquipmentImageProps {
  imageUrl: string | null | undefined;
  alt: string;
  size?: "thumbnail" | "full";
  className?: string;
  onClick?: () => void;
}

export function EquipmentImage({
  imageUrl,
  alt,
  size = "thumbnail",
  className,
  onClick,
}: EquipmentImageProps) {
  const sizeClasses = {
    thumbnail: "h-32 w-full object-cover",
    full: "h-full w-full object-contain",
  };

  if (!imageUrl) {
    return (
      <div
        className={cn(
          "bg-muted flex items-center justify-center",
          size === "thumbnail" ? "h-32" : "h-64",
          className
        )}
        onClick={onClick}
      >
        <ImageIcon className="text-muted-foreground size-8" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        size === "thumbnail" ? "h-32" : "h-64",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      <img
        src={imageUrl}
        alt={alt}
        className={cn(
          "absolute inset-0 size-full",
          sizeClasses[size],
          "transition-transform hover:scale-105"
        )}
      />
    </div>
  );
}
