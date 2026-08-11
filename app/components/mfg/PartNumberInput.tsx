"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { BtPartMetadataInfo } from "~/lib/onshapeApi/generated-wrapper";
import type { PartsPageSearchParams } from "~/onshape_connector/page";

interface PartNumberInputProps {
  part: BtPartMetadataInfo;
  queryParams: PartsPageSearchParams;
}

/**
 * Component for setting/displaying part number
 */
export function PartNumberInput({ part, queryParams }: PartNumberInputProps) {
  const [partNumberInput, setPartNumberInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    error?: string;
  } | null>(null);
  const router = useRouter();
  const lastSuccessRef = useRef<string | null>(null);

  // Handle successful part number update - only revalidate once per unique success
  useEffect(() => {
    // Only revalidate when we get a new success response (check by data identity)
    if (result?.success) {
      const successKey = JSON.stringify(result);

      // Only revalidate if this is a new success we haven't handled yet
      if (lastSuccessRef.current !== successKey) {
        setPartNumberInput("");
        lastSuccessRef.current = successKey;

        // Revalidate after a short delay to ensure update has propagated
        setTimeout(() => {
          router.refresh();
        }, 100);
      }
    } else if (!isSubmitting && !result) {
      // Reset when fully resets
      lastSuccessRef.current = null;
    }
  }, [result, isSubmitting, router]);

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResult(null);

    const formData = new FormData();
    formData.append("partId", part.partId || part.id || "");
    formData.append("partNumber", partNumberInput);
    formData.append("documentId", queryParams.documentId || "");
    formData.append("instanceType", queryParams.instanceType);
    formData.append("instanceId", queryParams.instanceId || "");
    formData.append("elementId", queryParams.elementId || "");

    try {
      const response = await fetch("/api/mfg/parts/actions", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ success: false, error: "Failed to update part number" });
    } finally {
      setIsSubmitting(false);
    }
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
