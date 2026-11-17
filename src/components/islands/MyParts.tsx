import { Workflow } from "./Workflow";
import { MyParts as MyPartsTab } from "~/components/phone/MyParts";

export default function MyParts(props: { viewerId: string }) {
  return (
    <Workflow>
      <MyPartsTab {...props} />
    </Workflow>
  );
}
