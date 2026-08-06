"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import { Modal, ModalClose } from "./ui";
import { ClientAvatar, CLIENT_ICONS, CLIENT_ICON_NAMES } from "./client-avatar";
import type { Client } from "@/lib/types";

/** The studio's client palette — the same hues the clients list already assigns. */
const CLIENT_COLORS = [
  "#06112f", "#0b43ed", "#1d32c8", "#6181e8", "#00a5b5", "#0f9d58",
  "#7c3aed", "#c026d3", "#e11d48", "#ea580c", "#ca8a04", "#6b7280",
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Colour + preset glyph + your own image, in that order of effort.
 *
 * Lives in its own file because two surfaces need the whole thing: the client
 * record modal (the pencil beside a client's name) and the Settings → Clients
 * list. A second copy would drift — the palette, the upload route and the
 * "uploaded image wins over the glyph" rule all have to agree.
 *
 * The upload goes through /api/client-icon rather than straight to storage,
 * because that route is where the admin check and the Content-Type allowlist
 * live — a browser-side upload with the anon key would have neither.
 */
export function ClientMarkPicker({ client }: { client: Client }) {
  const { updateClient, patchClientLocal } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hex, setHex] = useState(client.color);

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const body = new FormData();
    body.append("clientId", client.id);
    body.append("file", file);
    const res = await fetch("/api/client-icon", { method: "POST", body });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Upload failed");
      return;
    }
    // The route wrote the row with the service key, so the store has to be told
    // rather than asked — patch locally instead of issuing a second write.
    patchClientLocal(client.id, { iconUrl: json.iconUrl });
  }

  async function clearUpload() {
    setBusy(true);
    await fetch("/api/client-icon", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id }),
    });
    setBusy(false);
    patchClientLocal(client.id, { iconUrl: null });
  }

  function setColor(v: string) {
    setHex(v);
    if (v !== client.color) updateClient(client.id, { color: v });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <ClientAvatar client={client} size={36} />
        <div className="flex flex-wrap gap-1">
          {CLIENT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              aria-label={`Colour ${c}`}
              className={`size-5 rounded-md border transition-transform hover:scale-110 ${
                client.color.toLowerCase() === c ? "border-foreground" : "border-border"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/*
        Any colour, not just the twelve. The palette above covers the common case
        in one click; a client with a real brand colour needs to be able to say
        which one. The text field is the authority — a hex is what a brand
        guideline hands you, and it can be pasted.
      */}
      <div className="flex items-center gap-2 text-xs">
        <input
          type="color"
          value={HEX.test(client.color) ? client.color : "#0b43ed"}
          onChange={(e) => setColor(e.target.value)}
          className="size-7 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
          title="Pick any colour"
          aria-label="Pick any colour"
        />
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          // commit only a valid hex, and snap back otherwise: a half-typed
          // "#0b4" written to the row would paint every chip transparent
          onBlur={() => {
            const v = hex.trim();
            if (HEX.test(v)) setColor(v);
            else setHex(client.color);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
          placeholder="#0b43ed"
          className="w-24 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] outline-none focus:border-brand"
          title="Hex — paste or type, Enter to apply"
        />
        <span className="text-faint">Any hex, or pick from the palette.</span>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => updateClient(client.id, { icon: null })}
          title="Use the client's initial"
          className={`flex size-7 items-center justify-center rounded-md border text-xs font-semibold ${
            client.icon ? "border-border text-muted hover:border-brand" : "border-brand bg-brand-soft text-brand-dark"
          }`}
        >
          {client.name.charAt(0).toUpperCase()}
        </button>
        {CLIENT_ICON_NAMES.map((name) => {
          const Icon = CLIENT_ICONS[name];
          const active = client.icon === name;
          return (
            <button
              key={name}
              onClick={() => updateClient(client.id, { icon: name })}
              title={name}
              aria-label={name}
              className={`flex size-7 items-center justify-center rounded-md border ${
                active
                  ? "border-brand bg-brand-soft text-brand-dark"
                  : "border-border text-muted hover:border-brand hover:text-brand"
              }`}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="cursor-pointer rounded-md border border-border px-2 py-1 text-muted hover:border-brand hover:text-brand">
          {busy ? "Uploading…" : client.iconUrl ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.[0]) upload(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </label>
        {client.iconUrl && (
          <button onClick={clearUpload} disabled={busy} className="text-faint hover:text-danger">
            Remove image
          </button>
        )}
        <span className="text-faint">
          {client.iconUrl
            ? "Your image is used instead of the glyph."
            : "Square PNG or WebP on a transparent background, up to 2MB — it sits on the colour."}
        </span>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * The picker on its own, for surfaces that aren't already a client-record form.
 * Settings → Clients uses this: one row per client is no place for a 25-glyph
 * grid, but the mark still has to be editable from there.
 */
export function ClientMarkModal({ client, onClose }: { client: Client; onClose: () => void }) {
  return (
    <Modal onClose={onClose} width="lg" align="center" labelledBy="client-mark-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="client-mark-title" className="font-heading text-sm">
            Client mark
          </h3>
          <p className="bidi-auto truncate text-xs text-muted">{client.name}</p>
        </div>
        <ModalClose onClose={onClose} />
      </div>
      <ClientMarkPicker client={client} />
      <div className="mt-4 flex items-center justify-end border-t border-border pt-3">
        <button
          onClick={onClose}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Done
        </button>
      </div>
    </Modal>
  );
}
