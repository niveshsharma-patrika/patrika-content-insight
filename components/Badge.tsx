import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  error: "bg-red-50 text-red-700 ring-red-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  pass: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: keyof typeof styles;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        styles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
