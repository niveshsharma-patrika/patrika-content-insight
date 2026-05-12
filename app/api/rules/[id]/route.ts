import { NextResponse } from "next/server";
import { rules } from "@/lib/rules";
import { setRuleEnabled } from "@/lib/ruleSettings";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Toggle a rule on/off.
 *
 *   PATCH /api/rules/[id]   body: { enabled: boolean }
 *
 * `id` must match a rule defined in `lib/rules.ts` — otherwise the
 * write would orphan a row that no longer corresponds to any catalog
 * entry. The check guards against typo-as-DoS (someone POSTing 1000
 * fake rule_ids).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const known = rules.some((r) => r.id === id);
  if (!known) {
    return NextResponse.json(
      { ok: false, error: `Unknown rule id: ${id}` },
      { status: 404 },
    );
  }
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "Body must be { enabled: boolean }" },
      { status: 400 },
    );
  }
  try {
    await setRuleEnabled(id, body.enabled);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, ruleId: id, enabled: body.enabled });
}
