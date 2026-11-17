/** Latest recorded entry into a status; missing history means unknown time. */
export function latestStatusEntry(
  history: readonly { to_column_id: string; moved_at: string }[] | undefined,
  columnId: string
): string | undefined {
  return history
    ?.filter((entry) => entry.to_column_id === columnId)
    .sort((a, b) => b.moved_at.localeCompare(a.moved_at))[0]?.moved_at;
}
