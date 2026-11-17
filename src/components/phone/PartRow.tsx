import type { ReactNode } from "react";
import { partHref } from "~/lib/phone";
import { cn } from "~/lib/utils";

/**
 * One part in a phone list: its name and a short detail, linking to the part
 * page. `leading` holds a control before the link (a selection checkbox) and
 * `trailing` one after it (a Claim button); both stay outside the link so a
 * tap on them doesn't open the part. At least 44 px tall.
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
        className="text-foreground flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 py-2 no-underline"
      >
        <span className="min-w-0 font-semibold break-words">{card.title}</span>
        {detail && (
          <span className="text-muted-foreground shrink-0 text-right text-xs">
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
