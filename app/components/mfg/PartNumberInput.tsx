import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { partActions } from "~/lib/api";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { PartsPageSearchParams } from "~/onshape_connector/utils/types";

interface PartNumberInputProps {
  part: BtPartMetadataInfo;
  queryParams: PartsPageSearchParams;
}

/**
 * Component for setting/displaying part number
 */
export function PartNumberInput({ part, queryParams }: PartNumberInputProps) {
  const [partNumberInput, setPartNumberInput] = useState("");
  const router = useRouter();

  const updatePartNumber = useMutation({
    mutationFn: partActions.updatePartNumber,
    onSuccess: (result) => {
      if (!result.success) return;
      setPartNumberInput("");
      // Give the write a moment to propagate, then re-run the route loaders —
      // the equivalent of Next's router.refresh().
      setTimeout(() => router.invalidate(), 100);
    },
  });

  const isSubmitting = updatePartNumber.isPending;
  // A rejection (network, or a non-JSON response) reads the same as a failed
  // update to the user, which is what this component showed before.
  const result =
    updatePartNumber.data ??
    (updatePartNumber.error
      ? { success: false, error: "Failed to update part number" }
      : null);

  // If we don't have required params, show "not set"
  if (
    !queryParams.documentId ||
    !queryParams.instanceId ||
    !queryParams.elementId
  ) {
    return (
      <span className="text-muted-foreground text-xs">
        Part Number: Not set
      </span>
    );
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    updatePartNumber.mutate({
      partId: part.partId || part.id || "",
      partNumber: partNumberInput,
      documentId: queryParams.documentId || "",
      instanceType: queryParams.instanceType,
      instanceId: queryParams.instanceId || "",
      elementId: queryParams.elementId || "",
    });
  };

  // Show input form
  return (
    <div className="space-y-2">
      <Label
        htmlFor={`part-number-${part.partId || part.id}`}
        className="text-xs"
      >
        Part Number:
      </Label>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          id={`part-number-${part.partId || part.id}`}
          name="partNumber"
          value={partNumberInput}
          onChange={(e) => {
            console.log("[PartNumberInput] Input changed:", e.target.value);
            setPartNumberInput(e.target.value);
          }}
          placeholder="Enter part number"
          className="h-8 flex-1 text-xs"
          disabled={isSubmitting}
        />
        <Button
          type="submit"
          size="sm"
          className="h-8"
          disabled={isSubmitting || !partNumberInput.trim()}
        >
          {isSubmitting ? "Setting..." : "Set"}
        </Button>
      </form>
      {result && !result.success && result.error && (
        <p className="text-destructive text-xs">Error: {result.error}</p>
      )}
      {result?.success && (
        <p className="text-xs text-green-600 dark:text-green-400">
          Part number updated successfully!
        </p>
      )}
    </div>
  );
}
