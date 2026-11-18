export async function sendOtpEmail(email, otp, expiresInMinutes, purpose) {
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
        },
      }),
    });
    if (!response.ok) {
      // EmailJS explains itself in the body (e.g. "API calls are disabled for non-browser applications").
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      console.error("EmailJS rejected the request.", response.status, detail);
      throw new Error("EmailJS could not deliver the verification email.");
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("EmailJS delivery timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
