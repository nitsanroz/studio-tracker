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
  // ⚠️ A DANGEROUS confirm focuses CANCEL, so Enter or Space pressed out of
  // habit can't delete anything; a harmless one focuses its action.
  return (
    // `raised`: it is often opened from inside another modal (a settings popup).
    <Modal onClose={() => answer(false)} width="md" align="center" layer="raised" labelledBy="confirm-msg">
      <p id="confirm-msg" className="bidi-auto text-[13.5px] leading-relaxed">
        {message}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          autoFocus={danger}
          onClick={() => answer(false)}
          className="h-8 rounded-lg border border-border px-3 text-[12.5px]"
        >
          Cancel
        </button>
        <button
          autoFocus={!danger}
          onClick={() => answer(true)}
          className={`h-8 rounded-lg px-3 text-[12.5px] font-medium text-white ${danger ? "bg-danger" : "bg-brand"}`}
        >
          {action}
        </button>
      </div>
    </Modal>
  );
}

/**
 * ⚠️ One at a time: a second ask while one is open (a double-click on a
 * trash icon) answers "no" at once instead of stacking a second dialog —
 * which would also have run the action twice.
 */
let open = false;

export function askConfirm(message: string, opts?: { action?: string; danger?: boolean }): Promise<boolean> {
  if (open) return Promise.resolve(false);
  open = true;
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const answer = (ok: boolean) => {
      if (done) return;
      done = true;
      open = false;
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
