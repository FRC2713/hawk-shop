/**
 * Map column colors to Tailwind CSS classes
 */
export function getColumnColorClasses(color: string | null | undefined): {
  bg: string;
  text: string;
} {
  if (!color) {
    return { bg: "bg-secondary", text: "text-secondary-foreground" };
  }

  const colorLower = color.toLowerCase();

  const colorMap: Record<string, { bg: string; text: string }> = {
    white: { bg: "bg-white", text: "text-black" },
    yellow: { bg: "bg-yellow-500", text: "text-white" },
    orange: { bg: "bg-orange-500", text: "text-white" },
    red: { bg: "bg-primary", text: "text-primary-foreground" },
    pink: { bg: "bg-pink-500", text: "text-white" },
    purple: { bg: "bg-purple-500", text: "text-white" },
    blue: { bg: "bg-blue-500", text: "text-white" },
    green: { bg: "bg-green-500", text: "text-white" },
    brown: { bg: "bg-amber-700", text: "text-white" },
  };

  return (
    colorMap[colorLower] || {
      bg: "bg-secondary",
      text: "text-secondary-foreground",
    }
  );
}
