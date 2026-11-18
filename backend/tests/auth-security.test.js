import test from "node:test";
import assert from "node:assert/strict";
import { createOtp, hashPassword, isValidId, verifyPassword } from "../functions/lib/security.js";
import { claimOtpAttempt } from "../functions/lib/otp.js";
import {
  conversationOwnerFilter,
  messageOwnerFilter,
  normalizeEmail,
  validateRegistration,
} from "../functions/lib/validation.js";

test("passwords are stored as scrypt hashes and only verify for the correct secret", async () => {
  const password = "correct horse battery staple";
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("incorrect password", encoded), false);
});

test("OTP generation always returns six numeric digits", () => {
  for (let count = 0; count < 100; count += 1) {
    assert.match(createOtp(), /^\d{6}$/);
  }
});

test("OTP guesses are atomically claimed before verification and stop at five", async () => {
  const now = new Date();
  const challenge = { _id: "email:user-a", attempts: 0, expiresAt: new Date(now.getTime() + 60_000) };
  let claims = 0;
  const collection = {
    async findOneAndUpdate(filter, update, options) {
      claims += 1;
      assert.equal(filter._id, challenge._id);
      assert.equal(filter.expiresAt.$gt, now);
      assert.equal(filter.attempts.$lt, 5);
      assert.equal(update.$inc.attempts, 1);
      assert.equal(options.returnDocument, "after");
      if (challenge.expiresAt <= now || challenge.attempts >= filter.attempts.$lt) return null;
      challenge.attempts += update.$inc.attempts;
      return { ...challenge };
    },
  };

  const results = await Promise.all(
    Array.from({ length: 10 }, () => claimOtpAttempt(collection, challenge._id, now)),
  );
  assert.equal(claims, 10);
  assert.equal(results.filter(Boolean).length, 5);
  assert.equal(challenge.attempts, 5);
});

test("registration normalizes account identifiers and validates usernames", () => {
  const fields = validateRegistration({
    name: "  Alex Doe ",
    username: "Alex.Doe",
    email: "  ALEX@example.com ",
  });
  assert.deepEqual(fields, { name: "Alex Doe", username: "alex.doe", email: "alex@example.com" });
  assert.throws(() => normalizeEmail("not-an-email"), { status: 400 });
  assert.throws(() => validateRegistration({ name: "A", username: "x", email: "a@example.com" }), { status: 400 });
});

test("conversation and message lookup filters always bind the authenticated owner", () => {
  const userA = { _id: "user-a" };
  const userB = { _id: "user-b" };
  const conversationId = "62afecb4-9c31-4f4a-9b25-8d55d88f861a";
  assert.deepEqual(conversationOwnerFilter(userA._id, conversationId), { _id: conversationId, userId: userA._id });
  assert.notDeepEqual(conversationOwnerFilter(userA._id, conversationId), conversationOwnerFilter(userB._id, conversationId));
  assert.deepEqual(messageOwnerFilter(userA._id, conversationId), { userId: userA._id, conversationId });
  assert.equal(isValidId(conversationId), true);
  assert.equal(isValidId("conversation-from-client"), false);
});
