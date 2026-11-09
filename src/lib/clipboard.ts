/**
 * Copies `text`, or — when the browser refuses (Safari after an `await`, an
 * unfocused document, a blocked permission) — shows it in a prompt to copy by
 * hand. Resolves true only when the clipboard took it, so a caller says "copied"
 * only when that is true.
 *
 * ⚠️ The prompt is the one native dialog the app keeps on purpose: it only runs
 * when copying has already failed, and it works in every real browser. (In the
 * desktop app's pane it returns at once — nothing is lost, the link is still on
 * the page.)
 */
export async function copyText(text: string, label = "Copy this link:"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt(label, text);
    return false;
  }
}
