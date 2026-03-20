# Supabase Email Templates
# ─────────────────────────────────────────────────────────────
# Go to: Authentication → Email Templates in your Supabase dashboard.
# For each template below, copy the Subject and HTML into the
# corresponding template editor. Make sure "Enable Custom SMTP" is
# on if you want the from address to look professional.
# ─────────────────────────────────────────────────────────────


## ── CONFIRM SIGNUP ──────────────────────────────────────────
## Authentication → Email Templates → Confirm signup
## IMPORTANT: Set "Confirm email" to OTP mode in
## Authentication → Providers → Email → Confirm email → "OTP"

Subject:
Your Upwork Wizard verification code

HTML:
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify your account</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
          style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#111;padding:24px 32px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:18px;font-weight:700;color:#ffffff;">⚡ Upwork Wizard</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">
                Verify your account
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#999;line-height:1.6;">
                Enter this code in the extension to activate your free 30-day trial.
                The code expires in 10 minutes.
              </p>

              <!-- OTP code -->
              <div style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;
                          padding:24px;text-align:center;margin-bottom:28px;">
                <span style="font-size:38px;font-weight:800;color:#14a800;
                             letter-spacing:12px;font-family:'Courier New',monospace;">
                  {{ .Token }}
                </span>
              </div>

              <p style="margin:0;font-size:12px;color:#666;line-height:1.6;">
                If you didn't create an Upwork Wizard account, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #2a2a2a;
                       font-size:11px;color:#555;text-align:center;">
              Upwork Wizard · Sent because you signed up at upwork.com
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>


## ── RESET PASSWORD ──────────────────────────────────────────
## Authentication → Email Templates → Reset password

Subject:
Your Upwork Wizard password reset code

HTML:
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
          style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#111;padding:24px 32px;border-bottom:1px solid #2a2a2a;">
              <span style="font-size:18px;font-weight:700;color:#ffffff;">⚡ Upwork Wizard</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ffffff;">
                Reset your password
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#999;line-height:1.6;">
                Enter this code in the extension along with your new password.
                The code expires in 10 minutes.
              </p>

              <!-- OTP code -->
              <div style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:8px;
                          padding:24px;text-align:center;margin-bottom:28px;">
                <span style="font-size:38px;font-weight:800;color:#14a800;
                             letter-spacing:12px;font-family:'Courier New',monospace;">
                  {{ .Token }}
                </span>
              </div>

              <p style="margin:0;font-size:12px;color:#666;line-height:1.6;">
                If you didn't request a password reset, you can safely ignore this email.
                Your password will not change.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #2a2a2a;
                       font-size:11px;color:#555;text-align:center;">
              Upwork Wizard · Sent because you requested a password reset
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
