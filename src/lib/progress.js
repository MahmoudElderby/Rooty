export function createProgressBar({ stream, enabled = true, width = 24, prefix = "Installing Rooty" }) {
  let rendered = false;
  let closed = false;

  function update({ current, total, label }) {
    if (!enabled || closed) return;
    const safeTotal = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : 1;
    const safeCurrent = Math.min(safeTotal, Math.max(0, Number(current) || 0));
    const ratio = safeCurrent / safeTotal;
    const complete = Math.round(ratio * width);
    const bar = `${"#".repeat(complete)}${"-".repeat(width - complete)}`;
    const percent = String(Math.round(ratio * 100)).padStart(3, " ");
    stream.write(`\r\u001b[2K${prefix} [${bar}] ${percent}% ${String(label ?? "").trim()}`);
    rendered = true;
  }

  function finish() {
    if (!enabled || closed) return;
    if (rendered) stream.write("\n");
    closed = true;
  }

  function fail(label = "Installation failed") {
    if (!enabled || closed) return;
    stream.write(`\r\u001b[2K${prefix} [${"!".repeat(width)}] FAILED ${label}\n`);
    rendered = true;
    closed = true;
  }

  return { update, finish, fail };
}

