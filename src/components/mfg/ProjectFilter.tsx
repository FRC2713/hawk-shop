import { useQuery } from "@tanstack/react-query";
import { FilterMenu } from "~/components/mfg/FilterMenu";
import { projectsQuery, sortProjectsForDisplay } from "~/lib/api";

/** Multi-select project filter shared by the board and Done. */
export function ProjectFilter({
  selectedIds,
  onChange,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: projects = [] } = useQuery(projectsQuery());
  const sorted = sortProjectsForDisplay(projects);
  return (
    <FilterMenu
      label="Project"
      selectedIds={selectedIds}
      onChange={onChange}
      emptyText="No projects"
      groups={[
        { options: sorted.filter((project) => !project.archived_at) },
        {
          label: "Archived",
          // Archived projects stay filterable while they still have cards.
          options: sorted.filter(
            (project) => project.archived_at && project.card_count > 0
          ),
        },
      ]}
    />
  );
}
