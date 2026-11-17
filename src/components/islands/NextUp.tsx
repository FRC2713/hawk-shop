import { Workflow } from "./Workflow";
import { NextUp as NextUpTab } from "~/components/phone/NextUp";

export default function NextUp(props: { viewerId: string }) {
  return (
    <Workflow>
      <NextUpTab {...props} />
    </Workflow>
  );
}
