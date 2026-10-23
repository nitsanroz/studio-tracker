import { notFound } from "next/navigation";
import { AlignLab } from "./align-lab";

/**
 * Design lab, round 7: before / after for aligning the tracker with the studio
 * website's design system (Figma "Design Systems"). Fixture content, dev only.
 */
export const dynamic = "force-dynamic";

export default function AlignLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <AlignLab />;
}
