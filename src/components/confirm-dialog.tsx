"use client";

// An in-app replacement for `window.confirm`.
//
// ⚠️ WHY NOT window.confirm: the Claude desktop app's browser pane blocks
// native dialogs — `confirm()` returns false in ~1ms without showing anything,
// so every "are you sure?" there silently cancelled (found when deleting a
// lead "did nothing"). Browsers also let a user suppress a page's dialogs. An
// in-page modal works everywhere.
//
//   if (!(await askConfirm("Delete X?", { action: "Delete", danger: true }))) return;
//
// An imperative function rather than a hook, so any handler can ask without
// the component having to find somewhere in its JSX to render a dialog: it
// mounts its own small React root on <body> and removes it on answer. The
// `Modal` it uses reads no context, which is what makes that safe.

import { createRoot } from "react-dom/client";
import { Modal } from "./ui";

function ConfirmBox({
  message,
  action,
  danger,
  answer,
}: {
  message: string;
  action: string;
  danger: boolean;
  answer: (ok: boolean) => void;
}) {
  return (
    // `raised`: it is often opened from inside another modal (a settings popup).
    <Modal onClose={() => answer(false)} width="md" align="center" layer="raised" labelledBy="confirm-msg">
      <p id="confirm-msg" className="bidi-auto text-[13.5px] leading-relaxed">
        {message}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => answer(false)} className="h-8 rounded-lg border border-border px-3 text-[12.5px]">
          Cancel
        </button>
        <button
          autoFocus
          onClick={() => answer(true)}
          className={`h-8 rounded-lg px-3 text-[12.5px] font-medium text-white ${danger ? "bg-danger" : "bg-brand"}`}
        >
          {action}
        </button>
      </div>
    </Modal>
  );
}

export function askConfirm(message: string, opts?: { action?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const answer = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
      // Unmount after the click that answered has finished dispatching.
      setTimeout(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(
      <ConfirmBox message={message} action={opts?.action ?? "OK"} danger={opts?.danger ?? false} answer={answer} />,
    );
  });
}
