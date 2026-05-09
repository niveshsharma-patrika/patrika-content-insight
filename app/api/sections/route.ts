import { NextResponse } from "next/server";
import { listSections } from "@/lib/sections";

export async function GET() {
  const sections = await listSections();
  return NextResponse.json({ ok: true, sections });
}
