import { enigmaFont } from "@/lib/fonts";
import { cn } from "@/lib/utils";

/**
 * The ENIGMA wordmark. A gradient, letter-spaced display treatment that
 * pairs with the Patrika logo as the product's brand mark. Used in the
 * masthead and on the login screen.
 */
export function EnigmaWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        enigmaFont.className,
        "font-extrabold uppercase tracking-[0.14em] leading-none",
        "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600",
        "bg-clip-text text-transparent",
        className,
      )}
    >
      Enigma
    </span>
  );
}
