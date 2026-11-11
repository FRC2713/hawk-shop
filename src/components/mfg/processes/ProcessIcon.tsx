import { createElement } from "react";
import type { LucideProps } from "lucide-react";
import { processIcon } from "./processIcons";

interface ProcessIconProps extends LucideProps {
  process: { id: string; name: string };
}

/** A process's icon. Decorative: always render the process name beside it. */
export function ProcessIcon({ process, ...props }: ProcessIconProps) {
  return createElement(processIcon(process), {
    "aria-hidden": true,
    ...props,
  });
}
