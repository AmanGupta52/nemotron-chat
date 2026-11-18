import { getDb } from "./db.js";
import { sendOtpEmail } from "./email.js";
import { createOtp, HttpError, keyedDigest, secureEqualHex } from "./security.js";

export const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESENDS_PER_WINDOW = 3;

function challengeId(userId, purpose) {
  return `${purpose}:${userId.toString()}`;
}

export async function issueOtp(user, purpose) {
  const collection = (await getDb()).collection("challenges");
  const id = challengeId(user._id, purpose);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = new Date();
    const otp = createOtp();
    const otpHash = keyedDigest(`${user._id}:${purpose}:${otp}`, "otp");
    const existing = await collection.findOne({ _id: id });
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    if (!existing) {
      try {
        await collection.insertOne({
          _id: id,
          userId: user._id,
          purpose,
          otpHash,
          attempts: 0,
          resendCount: 0,
          windowStartedAt: now,
          lastSentAt: now,
          expiresAt,
          createdAt: now,
        });
      } catch (error) {
        if (error?.code === 11000) continue;
        throw error;
      }
    } else {
      if (now.getTime() - existing.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
        throw new HttpError(429, "Please wait before requesting another code.");
      }
      const newWindow = now.getTime() - existing.windowStartedAt.getTime() >= RESEND_WINDOW_MS;
      if (!newWindow && existing.resendCount >= MAX_RESENDS_PER_WINDOW) {
        throw new HttpError(429, "Too many codes were requested. Try again later.");
      }
      const result = await collection.updateOne({
        _id: id,
        otpHash: existing.otpHash,
        lastSentAt: existing.lastSentAt,
        resendCount: existing.resendCount,
        windowStartedAt: existing.windowStartedAt,
      }, {
        $set: {
          otpHash,
          attempts: 0,
          resendCount: newWindow ? 0 : existing.resendCount + 1,
          windowStartedAt: newWindow ? now : existing.windowStartedAt,
          lastSentAt: now,
          expiresAt,
        },
      });
      if (!result.matchedCount) continue;
    }

    const purposeText = purpose === "email-verification" ? "verify your email" : "reset your password";
    await sendOtpEmail(user.email, otp, OTP_EXPIRY_MS / 60_000, purposeText);
    return;
  }
  throw new HttpError(429, "A code request is already being processed. Please try again.");
}

export async function claimOtpAttempt(collection, id, now) {
  return collection.findOneAndUpdate(
    {
      _id: id,
      expiresAt: { $gt: now },
      attempts: { $lt: OTP_MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
}

export async function consumeOtp(user, purpose, submittedOtp) {
  if (typeof submittedOtp !== "string" || !/^\d{6}$/.test(submittedOtp)) {
    throw new HttpError(400, "Enter the 6-digit code.");
  }
  const collection = (await getDb()).collection("challenges");
  const id = challengeId(user._id, purpose);
  const now = new Date();
  const challenge = await claimOtpAttempt(collection, id, now);
  if (!challenge) throw new HttpError(400, "The code is invalid or expired.");

  const suppliedHash = keyedDigest(`${user._id}:${purpose}:${submittedOtp}`, "otp");
  if (!secureEqualHex(suppliedHash, challenge.otpHash)) {
    throw new HttpError(400, "The code is invalid or expired.");
  }

  const result = await collection.deleteOne({
    _id: id,
    otpHash: challenge.otpHash,
    expiresAt: { $gt: now },
  });
  if (!result.deletedCount) throw new HttpError(400, "The code is invalid or expired.");
}
