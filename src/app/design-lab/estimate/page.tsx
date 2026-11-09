import { notFound } from "next/navigation";
import { EstimateLab } from "./estimate-lab";

/**
 * Design lab, round 8: the client's shared offer page (`/estimate/[token]`) —
 * type scale, hierarchy and fonts. Fixture offer only; nothing reads the
 * database. Dev only.
 */
export const dynamic = "force-dynamic";

export default function EstimateLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EstimateLab />;
}
