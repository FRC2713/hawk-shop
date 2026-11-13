import { useEffect, useState } from "react";

/**
 * Board and Done project controls, kept in the URL so a filtered or grouped
 * view can be shared as a link: `?project=<id>&project=<id>&group=project&sort=project`.
 */
type ProjectView = {
  projectIds: string[];
  groupByProject: boolean;
  sortByProject: boolean;
};

function readView(): ProjectView {
  const params = new URL(window.location.href).searchParams;
  return {
    projectIds: params.getAll("project").filter(Boolean),
    groupByProject: params.get("group") === "project",
    sortByProject: params.get("sort") === "project",
  };
}

function writeView(view: ProjectView) {
  const url = new URL(window.location.href);
  url.searchParams.delete("project");
  for (const id of view.projectIds) url.searchParams.append("project", id);
  if (view.groupByProject) url.searchParams.set("group", "project");
  else url.searchParams.delete("group");
  if (view.sortByProject) url.searchParams.set("sort", "project");
  else url.searchParams.delete("sort");
  window.history.replaceState(window.history.state, "", url);
}

export function useUrlProjectView() {
  const [view, setView] = useState<ProjectView>({
    projectIds: [],
    groupByProject: false,
    sortByProject: false,
  });

  useEffect(() => {
    const restore = () => setView(readView());
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const update = (changes: Partial<ProjectView>) =>
    setView((current) => {
      const next = { ...current, ...changes };
      writeView(next);
      return next;
    });

  return {
    ...view,
    setProjectIds: (projectIds: string[]) => update({ projectIds }),
    setGroupByProject: (groupByProject: boolean) => update({ groupByProject }),
    setSortByProject: (sortByProject: boolean) => update({ sortByProject }),
  };
}
