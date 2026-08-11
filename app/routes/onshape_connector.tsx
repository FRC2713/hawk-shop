import { createFileRoute } from "@tanstack/react-router";
import { MfgPartsClient } from "~/onshape_connector/parts-client";
import type { PartsPageSearchParams } from "~/onshape_connector/utils/types";

export const Route = createFileRoute("/onshape_connector")({
  head: () => ({
    meta: [
      { title: "MFG Parts - Onshape Integration" },
      { name: "description", content: "View parts from Onshape Part Studio" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): PartsPageSearchParams => ({
    documentId: typeof search.documentId === "string" ? search.documentId : "",
    instanceType:
      search.instanceType === "v" || search.instanceType === "m"
        ? search.instanceType
        : "w",
    instanceId: typeof search.instanceId === "string" ? search.instanceId : "",
    elementId: typeof search.elementId === "string" ? search.elementId : "",
    elementType:
      typeof search.elementType === "string" ? search.elementType : "",
  }),
  component: MfgParts,
});

function MfgParts() {
  return <MfgPartsClient queryParams={Route.useSearch()} />;
}
