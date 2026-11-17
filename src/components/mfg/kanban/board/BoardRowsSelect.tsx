import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { BOARD_ROWS_LABELS, type BoardRowsBy } from "~/lib/boardRows";

/** Split each status column into rows; a view control for the filter bar. */
export function BoardRowsSelect({
  rowsBy,
  onChange,
  disabled,
}: {
  rowsBy: BoardRowsBy;
  onChange: (rowsBy: BoardRowsBy) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={rowsBy}
      onValueChange={(value) => onChange(value as BoardRowsBy)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" aria-label="Rows" className="gap-1">
        <span className="text-muted-foreground">Rows:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(BOARD_ROWS_LABELS) as BoardRowsBy[]).map((value) => (
          <SelectItem key={value} value={value}>
            {BOARD_ROWS_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
