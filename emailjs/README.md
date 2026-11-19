# EmailJS setup (one template for both emails)

The backend sends the verification code **and** the password-reset code through the **same** EmailJS template.
The wording changes automatically through the variables below.

## 1. Create the template
EmailJS > **Email Templates** > **Create New Template**, then fill in:

| Field | Value |
| --- | --- |
| Subject | `{{subject}}` |
| To Email | `{{to_email}}` |
| From Name | `{{app_name}}` |
| Reply To | your support address (optional) |
| Content | **Edit Content > Code Editor**, paste all of `otp-email-template.html` |

Save, then copy the **Template ID**.

## 2. Variables the server sends
`to_email`, `otp_code`, `expires_in_minutes`, `purpose`, `app_name`, `subject`, `heading`, `message`.
Use exactly these names. A typo shows an empty space in the email.

## 3. Account settings (required for a server)
EmailJS > **Account > Security**:
- Turn on **Allow EmailJS API for non-browser applications** (otherwise EmailJS answers 403).
- If **Use Private Key** is on, put the private key in `EMAILJS_PRIVATE_KEY` on the backend.

## 4. Backend environment variables (Render)
`EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, optional `EMAILJS_PRIVATE_KEY`, optional `APP_NAME`.

## 5. Test
Create an account (verification mail) and use **Forgot password** with that address (reset mail).
If nothing arrives, check the **spam** folder and the Render logs: a rejected request prints
`EmailJS rejected the request. <status> <reason>`.
Free EmailJS plans allow a limited number of emails per month.
