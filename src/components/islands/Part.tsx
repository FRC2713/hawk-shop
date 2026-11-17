import { Workflow } from "./Workflow";
import { PartPage } from "~/components/phone/PartPage";

export default function Part(props: { cardId: string; viewerId: string }) {
  return (
    <Workflow>
      <PartPage {...props} />
    </Workflow>
  );
}
