import { useEffect, useState } from "react";

/**
 * The time now, updated once a minute, so faces that show elapsed time (time
 * in status, flags, Done today) keep up while a page stays open. Use one per
 * page and pass it down rather than a timer per card.
 */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
