import { Workflow } from "./Workflow";
import { ShopTab } from "~/components/phone/ShopTab";

export default function Shop(props: { viewerId: string }) {
  return (
    <Workflow>
      <ShopTab {...props} />
    </Workflow>
  );
}
