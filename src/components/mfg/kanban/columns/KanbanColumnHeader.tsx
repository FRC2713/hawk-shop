import { useState, useRef, useEffect } from "react";
import { Input } from "~/components/ui/input";

interface KanbanColumnHeaderProps {
  title: string;
  onRename: (newTitle: string) => void;
  isEditing?: boolean;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  isReadOnly?: boolean;
}

export function KanbanColumnHeader({
  title,
  onRename,
  isEditing: externalIsEditing,
  onEditStart,
  onEditEnd,
  isReadOnly = false,
}: KanbanColumnHeaderProps) {
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Use external editing state if provided, otherwise use internal
  const isEditing = externalIsEditing ?? internalIsEditing;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Sync edit value when title changes or editing starts
  useEffect(() => {
    if (isEditing) {
      setEditValue(title);
    }
  }, [isEditing, title]);

  const handleStartEdit = () => {
    setEditValue(title);
    if (onEditStart) {
      onEditStart();
    } else {
      setInternalIsEditing(true);
    }
  };

  const handleSave = () => {
    if (editValue.trim()) {
      onRename(editValue.trim());
    } else {
      setEditValue(title);
    }
    if (onEditEnd) {
      onEditEnd();
    } else {
      setInternalIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditValue(title);
    if (onEditEnd) {
      onEditEnd();
    } else {
      setInternalIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className="bg-background h-7 font-semibold"
      />
    );
  }

  if (isReadOnly) {
    return (
      <div className="flex-1 truncate text-left font-semibold">{title}</div>
    );
  }

  return (
    <button
      onClick={handleStartEdit}
      className="hover:text-primary flex-1 truncate text-left font-semibold transition-colors"
    >
      {title}
    </button>
  );
}
