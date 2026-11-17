import { Workflow } from "./Workflow";
import { MyPartsTab } from "~/components/phone/MyPartsTab";

export default function MyParts(props: { viewerId: string }) {
  return (
    <Workflow>
      <MyPartsTab {...props} />
    </Workflow>
  );
}
