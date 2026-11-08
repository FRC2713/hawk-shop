import { Workflow } from "./Workflow";
import { MfgPartsClient } from "~/onshape_connector/parts-client";
import type { PartsPageSearchParams } from "~/onshape_connector/utils/types";
export default function Parts({
  queryParams,
}: {
  queryParams: PartsPageSearchParams;
}) {
  return (
    <Workflow>
      <MfgPartsClient queryParams={queryParams} />
    </Workflow>
  );
}
