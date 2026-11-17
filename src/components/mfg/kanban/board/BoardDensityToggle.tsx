import { Button } from "~/components/ui/button";
import type { BoardDensity } from "~/hooks/useBoardDensity";

const OPTIONS: { value: BoardDensity; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "pictures", label: "Pictures" },
];

/** Compact cards or large pictures; a view control for the filter bar. */
export function BoardDensityToggle({
  density,
  onChange,
}: {
  density: BoardDensity;
  onChange: (density: BoardDensity) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Density"
      className="flex overflow-hidden rounded-md border"
    >
      {OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={density === option.value ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={density === option.value}
          onClick={() => onChange(option.value)}
          className="rounded-none"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
