import Link from "next/link";
import Image from "next/image";

/**
 * Minimal masthead.
 *
 * The dashboard now has just two destinations:
 *   • The home page (live editorial overview)
 *   • Settings (authors directory + rule catalog)
 *
 * Anything else (rule catalog, article detail) is reached by clicking
 * through from one of those two places.
 */
export function HeaderNav() {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-3 group min-w-0"
          aria-label="Patrika Content Insight — home"
        >
          <Image
            src="/patrika-logo.png"
            alt="Patrika"
            width={310}
            height={112}
            priority
            className="h-7 w-auto"
          />
          <span className="hidden sm:inline-block text-[11px] uppercase tracking-[0.16em] text-muted border-l pl-3 ml-1 self-center leading-tight">
            Content Insight
          </span>
        </Link>
        <nav className="flex items-center text-sm">
          <Link
            href="/settings"
            className="inline-flex items-center justify-center size-9 rounded-md text-muted hover:text-foreground hover:bg-stone-100 transition-colors"
            title="Settings"
            aria-label="Settings"
          >
            <span className="text-2xl leading-none" aria-hidden="true">
              ⚙
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
