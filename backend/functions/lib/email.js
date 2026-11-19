const APP_NAME = process.env.APP_NAME || "Nemotron Workbench";

// Text shown in the e-mail. Works with the template in /emailjs/otp-email-template.html.
function emailCopy(purpose, otp) {
  if (/reset/i.test(purpose)) {
    return {
      subject: `${otp} is your ${APP_NAME} password reset code`,
      heading: "Reset your password",
      message: "Use this code to choose a new password. If you did not ask for this, you can safely ignore this email; your password will not change.",
    };
  }
  return {
    subject: `${otp} is your ${APP_NAME} verification code`,
    heading: "Verify your email",
    message: "Use this code to finish setting up your account.",
  };
}

export async function sendOtpEmail(email, otp, expiresInMinutes, purpose, extra = {}) {
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  if (!serviceId || !templateId || !publicKey) {
    throw new Error("EmailJS is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        // Needed when "Use Private Key (recommended)" is on in EmailJS > Account > Security.
        ...(process.env.EMAILJS_PRIVATE_KEY ? { accessToken: process.env.EMAILJS_PRIVATE_KEY } : {}),
        template_params: {
          to_email: email,
          otp_code: otp,
          expires_in_minutes: String(expiresInMinutes),
          purpose,
          app_name: APP_NAME,
          ...emailCopy(purpose, otp),
          ...(extra.message ? { message: extra.message } : {}),
        },
      }),
    });
    if (!response.ok) {
      // EmailJS explains itself in the body (e.g. "API calls are disabled for non-browser applications").
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      console.error("EmailJS rejected the request.", response.status, detail);
      throw new Error(`EmailJS could not deliver the email (HTTP ${response.status}).`);
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("EmailJS delivery timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
