import test from "node:test";
import assert from "node:assert/strict";
import { validatePassword } from "../functions/lib/security.js";

test("passwords need 8 to 128 characters", () => {
  assert.throws(() => validatePassword("1234567"), { status: 400 });
  assert.doesNotThrow(() => validatePassword("12345678"));
  assert.doesNotThrow(() => validatePassword("a".repeat(128)));
  assert.throws(() => validatePassword("a".repeat(129)), { status: 400 });
  assert.throws(() => validatePassword(undefined), { status: 400 });
});
