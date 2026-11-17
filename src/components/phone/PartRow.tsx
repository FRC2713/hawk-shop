import type { ReactNode } from "react";
import { partHref } from "~/lib/phone";
import { cn } from "~/lib/utils";

/**
 * One part in a phone list: its name and a short detail, linking to the part
 * page. `leading` holds a control before the link (a selection checkbox) and
 * `trailing` one after it (a Claim button); both stay outside the link so a
 * tap on them doesn't open the part. With either control the detail sits
 * under the title; without, beside it. At least 44 px tall.
 *
 * Put rows in a `PartList` so they share one bordered panel.
 */
export function PartRow({
  card,
  detail,
  leading,
  trailing,
  className,
}: {
  card: { id: string; title: string };
  /** Short secondary text, such as "Printer 2 · Sam" or "since 2 h". */
  detail?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  // A row with a control beside it has little width left, so its detail goes
  // under the title instead of beside it.
  const stacked = !!(leading || trailing);
  return (
    <li
      className={cn(
        "flex min-h-11 items-center gap-3 px-3 not-last:border-b",
        className
      )}
    >
      {leading}
      <a
        href={partHref(card.id)}
        className={cn(
          "text-foreground flex min-h-11 min-w-0 flex-1 py-2 no-underline",
          stacked
            ? "flex-col justify-center"
            : "items-center justify-between gap-3"
        )}
      >
        <span
          className={cn(
            "min-w-0 font-semibold break-words",
            !stacked && "flex-1"
          )}
        >
          {card.title}
        </span>
        {/* Capped so a long detail wraps instead of squeezing the title. */}
        {detail && (
          <span
            className={cn(
              "text-muted-foreground text-xs",
              !stacked && "max-w-[50%] text-right"
            )}
          >
            {detail}
          </span>
        )}
      </a>
      {trailing}
    </li>
  );
}

/** The bordered panel phone lists of `PartRow`s share. */
export function PartList({
  label,
  children,
  className,
}: {
  /** Accessible name for the list. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn("bg-card overflow-hidden rounded-xl border", className)}
    >
      {children}
    </ul>
  );
}
