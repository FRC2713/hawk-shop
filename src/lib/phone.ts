/**
 * The phone layout's routes and breakpoint. Client-safe: the layout, the board
 * redirect and the phone islands all read these.
 */

/**
 * Desktop starts at Tailwind's `lg` (64rem, 1024 px). Below it pages show the
 * bottom tabs and parts open on their own page; CSS uses `lg:` for the same
 * split.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";

export const PHONE_TABS = [
  { href: "/next", label: "Next up", icon: "next" },
  { href: "/backlog", label: "Backlog", icon: "backlog" },
  { href: "/shop", label: "Shop", icon: "shop" },
  { href: "/my-parts", label: "My parts", icon: "mine" },
] as const;

export type PhoneTab = (typeof PHONE_TABS)[number];

/** Where the phone layout lands when a page has no phone equivalent. */
export const PHONE_HOME = PHONE_TABS[0].href;

/** The part page for a card. Every phone list row links here. */
export function partHref(cardId: string): string {
  return `/parts/${encodeURIComponent(cardId)}`;
}

/**
 * Where a phone should go instead of the board at `boardUrl`: the part page
 * for a Slack link (`/kanban?cardId=…`), otherwise the first tab.
 */
export function phoneBoardRedirect(boardUrl: URL): string {
  const cardId = boardUrl.searchParams.get("cardId");
  return cardId ? partHref(cardId) : PHONE_HOME;
}
