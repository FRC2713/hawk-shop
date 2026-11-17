import { Workflow } from "./Workflow";
import { NextUpTab } from "~/components/phone/NextUpTab";

export default function NextUp(props: { viewerId: string }) {
  return (
    <Workflow>
      <NextUpTab {...props} />
    </Workflow>
  );
}
