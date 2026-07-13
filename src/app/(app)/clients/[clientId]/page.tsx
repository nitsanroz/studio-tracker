"use client";

import { use } from "react";
import { useData } from "@/lib/store";
import { ClientView } from "@/components/client-view";

export default function ClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = use(params);
  const { clients } = useData();
  const client = clients.find((c) => c.id === clientId);

  if (!client) return <div className="text-muted">Client not found.</div>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
        {client.billingPeriodNote && (
          <p className="text-sm text-muted">Billing: {client.billingPeriodNote}</p>
        )}
      </div>
      <ClientView clientId={clientId} />
    </div>
  );
}
