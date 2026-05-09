import Link from "next/link";
import {
  dayChipLabel,
  lastNIstDays,
  todayInIST,
} from "@/lib/dates";

const RETENTION_DAYS = 7;

/**
 * Server-rendered day picker. Seven chips for the retention window,
 * newest-first. The active date is highlighted; clicking another chip
 * navigates to `?date=YYYY-MM-DD` (or `/` for today).
 *
 * Pure links — no client JS needed. Each chip is a normal `<a>`.
 */
export function DatePicker({ activeDate }: { activeDate: string }) {
  const days = lastNIstDays(RETENTION_DAYS);
  const today = todayInIST();
  return (
    <nav
      aria-label="Pick a date"
      className="flex flex-wrap items-center gap-1.5"
    >
      {days.map((d) => {
        const isActive = d === activeDate;
        const isToday = d === today;
        const href = isToday ? "/" : `/?date=${d}`;
        return (
          <Link
            key={d}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "inline-flex items-center rounded-md bg-foreground text-background px-2.5 py-1 text-xs font-medium tabular-nums"
                : "inline-flex items-center rounded-md border bg-card hover:bg-stone-50 px-2.5 py-1 text-xs text-muted hover:text-foreground tabular-nums"
            }
          >
            {dayChipLabel(d)}
          </Link>
        );
      })}
    </nav>
  );
}
