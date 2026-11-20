import { ErrorDisplay } from "~/components/mfg/ErrorDisplay";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import type { ProcessRow } from "~/server/db/types";
import { processesQuery } from "~/lib/api";
import { AddProcessDialog } from "./AddProcessDialog";
import { DeleteProcessDialog } from "./DeleteProcessDialog";
import { EditProcessDialog } from "./EditProcessDialog";
import { ProcessCard } from "./ProcessCard";

export function ProcessesSection() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<ProcessRow | null>(
    null
  );

  const { data: processes = [], isLoading, error } = useQuery(processesQuery());

  const handleEdit = (process: ProcessRow) => {
    setSelectedProcess(process);
    setEditDialogOpen(true);
  };

  const handleDelete = (process: ProcessRow) => {
    setSelectedProcess(process);
    setDeleteDialogOpen(true);
  };

  if (error) return <ErrorDisplay error={error} />;

  return (
    <>
      <section
        aria-labelledby="processes-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="processes-heading" className="section-title">
              Manufacturing processes
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Processes you can assign to equipment and parts.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setAddDialogOpen(true)}
            className="min-h-11 lg:min-h-9"
          >
            <Plus aria-hidden="true" />
            Add process
          </Button>
        </div>
        {isLoading ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg lg:h-24" />
            ))}
          </div>
        ) : processes.length === 0 ? (
          <div className="bg-card flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
            <Layers
              className="text-icon-accent mb-3 size-8"
              aria-hidden="true"
            />
            <h3 className="mb-1 text-base font-semibold">No processes yet</h3>
            <p className="text-muted-foreground max-w-sm text-sm">
              Add manufacturing processes to assign to equipment and parts.
            </p>
          </div>
        ) : (
          <ul className="bg-card divide-y overflow-hidden rounded-xl border shadow-xs lg:grid lg:grid-cols-3 lg:gap-3 lg:divide-y-0 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none">
            {processes.map((process) => (
              <li key={process.id} className="min-w-0">
                <ProcessCard
                  process={process}
                  onEdit={() => handleEdit(process)}
                  onDelete={() => handleDelete(process)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddProcessDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
      <EditProcessDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        process={selectedProcess}
      />
      <DeleteProcessDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        process={selectedProcess}
      />
    </>
  );
}
