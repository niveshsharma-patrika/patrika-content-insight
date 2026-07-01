import Image from "next/image";
import { LoginForm } from "./LoginForm";
import { EnigmaWordmark } from "@/components/EnigmaLogo";

export const metadata = {
  title: "Sign in · Patrika Enigma",
};

// Never cache the login page — it's tiny and we want any visit to
// re-evaluate the auth gate.
export const dynamic = "force-dynamic";

/**
 * Login screen.
 *
 * If the proxy redirected here from a deep link (e.g. a Telegram nudge
 * pointing at /articles/[id]), the original path is in `?next=`. We
 * pass it down so a successful login lands the user back where they
 * started instead of dumping them on the home page.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const next = sanitizeNextParam(sp.next);

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-3">
            <Image
              src="/patrika-logo.png"
              alt="Patrika"
              width={310}
              height={112}
              priority
              className="h-9 w-auto"
            />
            <span className="border-l pl-3">
              <EnigmaWordmark className="text-3xl" />
            </span>
          </div>
          <p className="text-sm text-muted">
            Sign in with the team credentials to continue.
          </p>
        </div>
        <LoginForm nextPath={next} />
        <p className="text-[11px] text-center text-muted">
          If you don&apos;t have credentials, ask your editorial lead.
        </p>
      </div>
    </div>
  );
}

/**
 * Restrict `?next=` to in-app paths only — no protocol-relative URLs,
 * no http(s)://, no `\` paths. Prevents an open-redirect on the login
 * flow (someone tricking a logged-in editor into ?next=https://evil/).
 */
function sanitizeNextParam(raw: string | undefined): string {
  if (!raw) return "/";
  // Decode in case it arrived URL-encoded.
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Use raw — sanitization below still rejects bad shapes.
  }
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/"; // protocol-relative
  if (value.startsWith("/\\")) return "/";
  return value;
}
