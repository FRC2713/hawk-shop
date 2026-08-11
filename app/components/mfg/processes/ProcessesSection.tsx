"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import type { ProcessRow } from "~/lib/db/types";
import { AddProcessDialog } from "./AddProcessDialog";
import { DeleteProcessDialog } from "./DeleteProcessDialog";
import { EditProcessDialog } from "./EditProcessDialog";
import { ProcessCard } from "./ProcessCard";

async function fetchProcesses(): Promise<{ processes: ProcessRow[] }> {
  const response = await fetch("/api/processes");
  if (!response.ok) {
    throw new Error("Failed to fetch processes");
  }
  return response.json();
}

export function ProcessesSection() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<ProcessRow | null>(
    null
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["processes"],
    queryFn: fetchProcesses,
    staleTime: 5 * 60 * 1000,
  });

  const processes = data?.processes ?? [];

  const handleEdit = (process: ProcessRow) => {
    setSelectedProcess(process);
    setEditDialogOpen(true);
  };

  const handleDelete = (process: ProcessRow) => {
    setSelectedProcess(process);
    setDeleteDialogOpen(true);
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive text-center text-sm">
            Failed to load processes.{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Manufacturing Processes
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Manage processes that can be assigned to equipment and kanban
              cards
            </p>
          </div>
          <Button
            onClick={() => setAddDialogOpen(true)}
            className="w-full sm:w-auto"
          >
            <Plus className="mr-2 size-4" />
            Add Process
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : processes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <div className="bg-primary/10 mb-4 flex size-16 items-center justify-center rounded-full">
                <Layers className="text-primary size-8" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">No processes yet</h3>
              <p className="text-muted-foreground mb-6 max-w-sm text-sm">
                Add manufacturing processes to assign to equipment and kanban
                cards.
              </p>
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="mr-2 size-4" />
                Add Process
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {processes.map((process) => (
                <ProcessCard
                  key={process.id}
                  process={process}
                  onEdit={() => handleEdit(process)}
                  onDelete={() => handleDelete(process)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
