import { Workflow } from "./Workflow";
import { ShopPage } from "~/components/phone/ShopPage";

export default function Shop(props: { viewerId: string }) {
  return (
    <Workflow>
      <ShopPage {...props} />
    </Workflow>
  );
}
