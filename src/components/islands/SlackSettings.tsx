import { Workflow } from "./Workflow";
import { SlackSettingsClient } from "~/components/app/slack-settings-client";
export default function SlackSettings() {
  return (
    <Workflow>
      <SlackSettingsClient />
    </Workflow>
  );
}
