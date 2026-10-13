import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demoDeals,
  parseWishlist,
  serviceError,
  usd,
} from "../src/services.ts";
test("wishlist recovers corruption and deduplicates game snapshots", () => {
  assert.deepEqual(parseWishlist("{broken"), []);
  assert.deepEqual(
    parseWishlist(
      JSON.stringify([
        demoDeals[0],
        { gameID: "2", title: "missing fields" },
        demoDeals[0],
      ]),
    ),
    [demoDeals[0]],
  );
});
test("unknown network errors never surface URLs or credentials", () => {
  assert.equal(
    serviceError("request failed https://example.com/?key=private"),
    "serviceUnavailable",
  );
  assert.equal(serviceError("rateLimit"), "rateLimit");
  assert.equal(serviceError("desktopRequired"), "desktopRequired");
  // Feature-specific keys pass only where the caller allows them.
  assert.equal(serviceError("uninstallBusy"), "serviceUnavailable");
  assert.equal(serviceError("uninstallBusy", ["uninstallBusy"]), "uninstallBusy");
});
test("prices use the provider currency and reject malformed numeric values", () => {
  assert.equal(usd("20.99", "en"), "$20.99");
  assert.equal(usd("not a price", "en"), "—");
});
