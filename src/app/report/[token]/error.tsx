"use client"; // Error boundaries must be Client Components.

import { PublicError } from "@/components/public-error";

/** Client-facing fallback — see `PublicError` for why it says nothing technical. */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return <PublicError error={error} what="This report" />;
}
