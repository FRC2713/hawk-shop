import { useCallback, useEffect, useState } from "react";

/**
 * A choice remembered per browser in localStorage. Islands render on the
 * server too, so the first render always uses `initial` and the stored value
 * is read after hydration; `read` turns the stored string (null when absent
 * or unreadable) into a value.
 */
export function useBrowserPreference<T extends string>(
  key: string,
  initial: T,
  read: (stored: string | null) => T
) {
  const [value, setValue] = useState<T>(initial);
  // `read` is fixed per call site; read storage once, after hydration.
  useEffect(() => setValue(read(readStorage(key))), [key]);
  const setPreference = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Private windows may refuse storage; the choice still holds for this visit.
      }
    },
    [key]
  );
  return [value, setPreference] as const;
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
