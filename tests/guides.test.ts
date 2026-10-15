import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Some agents read at most 32 KiB of project instructions and drop the rest silently.
test("the agent guides together stay under 32 KiB", () => {
  const guides = [
    "AGENTS.md",
    "src/AGENTS.md",
    "src-tauri/AGENTS.md",
    "tests/AGENTS.md",
    "docs/AGENTS.md",
    "widget/AGENTS.md",
  ];
  const bytes = guides.reduce(
    (sum, file) =>
      sum + readFileSync(new URL(`../${file}`, import.meta.url)).byteLength,
    0,
  );
  assert.ok(bytes < 32 * 1024, `${bytes} bytes`);
});
