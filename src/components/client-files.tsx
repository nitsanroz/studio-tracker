"use client";

// Files on a client's Overview tab (0050 `client_files`). Task-attachment
// rules: everyone reads and adds; the uploader or an admin removes.

import { useCallback } from "react";
import { useData, useIsAdmin } from "@/lib/store";
import { addClientFile, clientFileHref, loadClientFiles, removeClientFile, type OverviewFile } from "@/lib/overview-files";
import { OverviewFiles } from "./overview-files";

export function ClientFiles({ clientId }: { clientId: string }) {
  const { currentUserId } = useData();
  const isAdmin = useIsAdmin();
  const load = useCallback(() => loadClientFiles(clientId), [clientId]);
  const add = useCallback((f: File) => addClientFile(clientId, f, currentUserId), [clientId, currentUserId]);
  const remove = useCallback((f: OverviewFile) => removeClientFile(f.id), []);
  return (
    <OverviewFiles
      load={load}
      add={add}
      remove={remove}
      href={clientFileHref}
      canRemove={(f) => isAdmin || f.uploadedBy === currentUserId}
      className="mt-4"
    />
  );
}
