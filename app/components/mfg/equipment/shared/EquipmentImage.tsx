import { Image as ImageIcon } from "lucide-react";
import Image from "next/image";
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
      <Image
        src={imageUrl}
        alt={alt}
        fill
        className={cn(
          sizeClasses[size],
          "transition-transform hover:scale-105"
        )}
        sizes={
          size === "thumbnail" ? "(max-width: 768px) 100vw, 33vw" : "100vw"
        }
      />
    </div>
  );
}
