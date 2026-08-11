import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KanbanSquare, Search, Settings2, Edit, Save, X } from "lucide-react";
import {
  KanbanBoard,
  KanbanBoardSkeleton,
} from "~/components/mfg/kanban/board/KanbanBoard";
import { KanbanBoardErrorBoundary } from "~/components/mfg/kanban/board/KanbanBoardErrorBoundary";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { KanbanConfig, KanbanColumn } from "~/lib/kanbanApi/columnTypes";
import { KanbanBoardControls } from "~/components/mfg/kanban/board/KanbanBoardControls";
import { useQuery } from "@tanstack/react-query";
import { kanbanConfigQuery, queryKeys, saveKanbanConfig } from "~/lib/api";

export function MfgKanbanClient() {
  const queryClient = useQueryClient();
  const [isEditMode, setIsEditMode] = useState(false);
  const [hideImages, setHideImages] = useState(false);
  const [selectedProcessIds, setSelectedProcessIds] = useState<string[]>([]);
  const [sortByUser, setSortByUser] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [originalConfig, setOriginalConfig] = useState<KanbanConfig | null>(
    null
  );

  // Fetch Kanban config
  const { data: config, isLoading } = useQuery(kanbanConfigQuery());

  // Save config mutation with optimistic updates
  const saveConfigMutation = useMutation({
    mutationFn: saveKanbanConfig,
    onMutate: async (newConfig) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.kanban.config() });

      // Snapshot previous value
      const previousConfig = queryClient.getQueryData<KanbanConfig>(
        queryKeys.kanban.config()
      );

      // Optimistically update
      queryClient.setQueryData(queryKeys.kanban.config(), newConfig);

      return { previousConfig };
    },
    onSuccess: (config) => {
      // Update the cache with the server response
      queryClient.setQueryData(queryKeys.kanban.config(), config);
      toast.success("Configuration saved");
    },
    onError: (error, variables, context) => {
      // Rollback on error
      if (context?.previousConfig) {
        queryClient.setQueryData(
          queryKeys.kanban.config(),
          context.previousConfig
        );
      }
      toast.error("Failed to save configuration", {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    },
  });

  const handleConfigChange = (newConfig: KanbanConfig) => {
    // Only update local state when in edit mode
    // Actual save happens when user clicks Save button
    if (isEditMode) {
      queryClient.setQueryData(queryKeys.kanban.config(), newConfig);
    }
  };

  const handleEnterEditMode = () => {
    if (config) {
      // Store original config for cancel functionality
      setOriginalConfig(JSON.parse(JSON.stringify(config)));
      setIsEditMode(true);
    }
  };

  const handleSave = () => {
    if (config) {
      // Save to server
      saveConfigMutation.mutate(config, {
        onSuccess: () => {
          setIsEditMode(false);
          setOriginalConfig(null);
        },
      });
    }
  };

  const handleCancel = () => {
    if (originalConfig) {
      // Revert to original config
      queryClient.setQueryData(queryKeys.kanban.config(), originalConfig);
      setIsEditMode(false);
      setOriginalConfig(null);
    }
  };

  const handleHideImages = () => {
    setHideImages(!hideImages);
  };

  const handleProcessFilterChange = (processIds: string[]) => {
    setSelectedProcessIds(processIds);
  };

  const handleSortByUserChange = (value: boolean) => {
    setSortByUser(value);
  };

  // Column operation handlers
  const handleAddColumn = useCallback(() => {
    if (config) {
      const newColumn: KanbanColumn = {
        id: `column-${Date.now()}`,
        title: "New Column",
        position: config.columns.length,
      };
      const updatedConfig: KanbanConfig = {
        ...config,
        columns: [...config.columns, newColumn],
      };
      queryClient.setQueryData(queryKeys.kanban.config(), updatedConfig);
    }
  }, [config, queryClient]);

  const handleRenameColumn = useCallback(
    (id: string, newTitle: string) => {
      if (config) {
        const updatedConfig: KanbanConfig = {
          ...config,
          columns: config.columns.map((col) =>
            col.id === id ? { ...col, title: newTitle } : col
          ),
        };
        queryClient.setQueryData(queryKeys.kanban.config(), updatedConfig);
      }
    },
    [config, queryClient]
  );

  const handleDeleteColumn = useCallback(
    (id: string) => {
      if (config) {
        const updatedConfig: KanbanConfig = {
          ...config,
          columns: config.columns.filter((col) => col.id !== id),
        };
        queryClient.setQueryData(queryKeys.kanban.config(), updatedConfig);
      }
    },
    [config, queryClient]
  );

  const handleReorderColumns = useCallback(
    (newColumns: KanbanColumn[]) => {
      if (config) {
        const updatedConfig: KanbanConfig = {
          ...config,
          columns: newColumns.map((col, index) => ({
            ...col,
            position: index,
          })),
        };
        queryClient.setQueryData(queryKeys.kanban.config(), updatedConfig);
      }
    },
    [config, queryClient]
  );

  return (
    <main className="bg-background flex h-full flex-1 flex-col overflow-hidden">
      {/* Page Header */}
      <header className="bg-muted/30 relative border-b bg-linear-to-r">
        <div className="relative px-4 py-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="bg-primary/10 ring-primary/20 flex size-6 shrink-0 items-center justify-center rounded-xl ring-1 sm:size-8">
                <KanbanSquare className="text-primary size-5 sm:size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Kanban Board
                </h1>
              </div>
            </div>
            <div className="relative w-full min-w-0 flex-1 sm:max-w-md">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                type="text"
                placeholder="Search by part number or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pr-9 pl-9"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1/2 right-0 size-8 -translate-y-1/2"
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
            <KanbanBoardControls
              isEditMode={isEditMode}
              handleEnterEditMode={handleEnterEditMode}
              config={config}
              onEditCancel={handleCancel}
              onEditSave={handleSave}
              isSaving={saveConfigMutation.isPending}
              onHideImages={handleHideImages}
              hideImages={hideImages}
              selectedProcessIds={selectedProcessIds}
              onProcessFilterChange={handleProcessFilterChange}
              sortByUser={sortByUser}
              onSortByUserChange={handleSortByUserChange}
            />
          </div>
        </div>
      </header>

      {/* Board Content */}
      <div className="flex-1 overflow-hidden">
        <KanbanBoardErrorBoundary>
          {isLoading ? (
            <KanbanBoardSkeleton />
          ) : config ? (
            <KanbanBoard
              config={config}
              onConfigChange={handleConfigChange}
              isEditMode={isEditMode}
              hideImages={hideImages}
              processFilterIds={selectedProcessIds}
              sortByUser={sortByUser}
              searchQuery={searchQuery}
              onAddColumn={isEditMode ? handleAddColumn : undefined}
              onRenameColumn={isEditMode ? handleRenameColumn : undefined}
              onDeleteColumn={isEditMode ? handleDeleteColumn : undefined}
              onReorderColumns={isEditMode ? handleReorderColumns : undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-muted-foreground">
                  Failed to load configuration
                </p>
              </div>
            </div>
          )}
        </KanbanBoardErrorBoundary>
      </div>
    </main>
  );
}
