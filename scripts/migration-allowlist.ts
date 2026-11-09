/** Migration tag -> reason for intentionally dropping rows or rewriting values.
 * Explicit DROP TABLE statements already permit the named table to disappear.
 * This never exempts temporary tables, foreign keys, integrity or seed coverage.
 */
export const migrationAllowlist: Readonly<Record<string, string>> = {};
