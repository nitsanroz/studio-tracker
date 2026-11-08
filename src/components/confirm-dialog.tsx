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

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Modal } from "./ui";
import { Input } from "./primitives";

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

function TextBox({
  message,
  action,
  initial,
  placeholder,
  answer,
}: {
  message: string;
  action: string;
  initial: string;
  placeholder?: string;
  answer: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = () => value.trim() && answer(value.trim());
  return (
    <Modal onClose={() => answer(null)} width="md" align="center" layer="raised" labelledBy="ask-text-msg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label id="ask-text-msg" htmlFor="ask-text-input" className="bidi-auto block text-[13.5px] leading-relaxed">
          {message}
        </label>
        <Input
          id="ask-text-input"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          className="bidi-auto mt-2 w-full"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => answer(null)} className="h-8 rounded-lg border border-border px-3 text-[12.5px]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="h-8 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white disabled:opacity-50"
          >
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * An in-app replacement for `window.prompt`, for the same reason as `askConfirm`:
 * the desktop pane answers native dialogs at once (`prompt()` returns null without
 * showing anything), so "+ New section" / "New group" silently did nothing there.
 * Resolves to the trimmed text, or null when cancelled. Shares `askConfirm`'s
 * one-at-a-time guard.
 *
 *   const name = await askText("Name for the new group", { action: "Add" });
 */
export function askText(
  message: string,
  opts?: { action?: string; initial?: string; placeholder?: string },
): Promise<string | null> {
  if (open) return Promise.resolve(null);
  open = true;
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const answer = (value: string | null) => {
      if (done) return;
      done = true;
      open = false;
      resolve(value);
      setTimeout(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(
      <TextBox
        message={message}
        action={opts?.action ?? "OK"}
        initial={opts?.initial ?? ""}
        placeholder={opts?.placeholder}
        answer={answer}
      />,
    );
  });
}
