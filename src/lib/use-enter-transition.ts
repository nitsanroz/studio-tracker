"use client";

import { useEffect, useState } from "react";

/**
 * Returns false on mount and true one frame later, so a panel can animate IN.
 *
 * ⚠️ THE ENTER MUST CROSS A PAINT, or there is nothing to animate from. Mounting
 * and setting the open state in the same commit gives the browser one frame with
 * only the final value in it, so it draws the panel already open. Hence
 * `requestAnimationFrame` — not `setTimeout(0)`, which can land inside the same
 * frame.
 *
 * ⚠️ THIS HOOK DOES NOT OWN THE EXIT, and the first version of it did — it kept
 * the panel mounted on a timer and handed back a `render` flag. That forced the
 * caller to remember the thing it was showing (the task pane derives ~15 values
 * from `task`, which is null the moment the pane closes), and holding that in a
 * ref meant READING A REF DURING RENDER. The React Compiler is right to refuse
 * that: it took eslint from 38 warnings to 111, 72 of them cascading from the one
 * ref. The exit belongs to the caller instead — it delays clearing its OWN state
 * until the animation is done, so the data stays real throughout. See
 * `closePane` in `task-panel.tsx`.
 *
 * ⚠️ It sets state from an effect, which `react-hooks/set-state-in-effect`
 * advises against. Deliberate, and the whole job: react to a prop change one
 * frame later. There is no render-time expression that can do that.
 */
export function useEnterTransition(open: boolean) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const f = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(f);
  }, [open]);

  return entered;
}
