import { notFound } from "next/navigation";
import { LoginLab } from "./login-lab";

/**
 * Design lab, round 7: the sign-in page (and so the reset page, which shares
 * its frame). Static fields, nothing signs in. Dev only.
 */
export const dynamic = "force-dynamic";

export default function LoginLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LoginLab />;
}
