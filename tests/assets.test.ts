import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Width and height from a PNG's IHDR chunk. */
const size = (path: string) => {
  const png = readFileSync(new URL(`../${path}`, import.meta.url));
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

// The Windows packages (identity and Game Bar widget) reject logos of any other size
// (APPX1619), and only CI on Windows builds them: catch it here first.
test("package logos have the exact sizes Windows requires", () => {
  const dir = "src-tauri/packaging/Assets";
  for (const [file, px] of [
    ["Square44x44Logo.png", 44],
    ["Square150x150Logo.png", 150],
    ["StoreLogo.png", 50],
    ["WidgetSmallLogo.png", 44],
    ["WidgetSmallLogo.scale-200.png", 88],
  ] as const)
    assert.deepEqual(size(`${dir}/${file}`), [px, px], file);
});
