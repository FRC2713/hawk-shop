import type { BtColorInfo } from "~/lib/onshapeApi/generated-wrapper";
import { cn } from "~/lib/utils";

export function PartColorChip({ color }: { color: BtColorInfo | undefined }) {
  const hasColor = color?.red && color?.green && color?.blue;

  if (!hasColor) {
    return <div className="h-2 w-2 rounded-full bg-gray-500">No color</div>;
  }

  return (
    <div
      className={cn("h-4 w-4 rounded-full")}
      style={{
        backgroundColor: `#${color.red?.toString(16)}${color.green?.toString(16)}${color.blue?.toString(16)}`,
      }}
    ></div>
  );
}
