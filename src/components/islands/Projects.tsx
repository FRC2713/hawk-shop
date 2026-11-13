import { Workflow } from "./Workflow";
import { ProjectsClient } from "~/components/app/projects-client";
export default function Projects() {
  return (
    <Workflow>
      <ProjectsClient />
    </Workflow>
  );
}
