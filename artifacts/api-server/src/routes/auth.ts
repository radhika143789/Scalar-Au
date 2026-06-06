import { Router } from "express";
import { google } from "googleapis";

const router = Router();

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
}

function getRedirectUri() {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  return `https://${domain}/api/auth/google/callback`;
}

// Step 1 — Redirect user to Google consent screen
router.get("/auth/google", (req, res) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",          // force refresh_token every time
    scope: [
      "https://www.googleapis.com/auth/calendar",
    ],
  });
  res.redirect(url);
});

// Step 2 — Google redirects here with ?code=...
router.get("/auth/google/callback", async (req, res) => {
  const { code, error } = req.query as { code?: string; error?: string };

  if (error) {
    res.send(`<pre style="font-family:monospace;padding:2rem;background:#111;color:#f66">
OAuth error: ${error}
Close this tab and try again.
</pre>`);
    return;
  }

  if (!code) {
    res.status(400).send("No code received");
    return;
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      res.send(`<pre style="font-family:monospace;padding:2rem;background:#111;color:#fa0">
No refresh_token in response.
This usually means the account already has a valid token.
Try visiting: <a href="/api/auth/google">/api/auth/google</a> again after revoking access at:
https://myaccount.google.com/permissions
</pre>`);
      return;
    }

    res.send(`<!DOCTYPE html>
<html>
<head><title>Google Auth Success</title>
<style>
  body { background: #0d1117; color: #c9d1d9; font-family: monospace; padding: 2rem; }
  .box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.5rem; max-width: 700px; }
  h2 { color: #58a6ff; margin-top: 0; }
  .token { background: #0d1117; border: 1px solid #388bfd; border-radius: 6px; padding: 1rem; word-break: break-all; color: #79c0ff; font-size: 0.85rem; margin: 0.5rem 0 1rem; }
  .step { margin: 0.75rem 0; }
  .num { color: #3fb950; font-weight: bold; }
  button { background: #238636; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.9rem; }
  button:hover { background: #2ea043; }
  .success { color: #3fb950; font-size: 0.85rem; display: none; margin-left: 0.5rem; }
</style>
</head>
<body>
<div class="box">
  <h2>✅ Google Calendar Authorised</h2>
  <p>Copy the refresh token below and add it as a secret named <strong>GOOGLE_REFRESH_TOKEN</strong>.</p>

  <div class="token" id="token">${refreshToken}</div>

  <button onclick="copyToken()">Copy Token</button>
  <span class="success" id="ok">✓ Copied!</span>

  <div style="margin-top:1.5rem; border-top: 1px solid #30363d; padding-top:1rem">
    <p class="step"><span class="num">1.</span> Click "Copy Token" above</p>
    <p class="step"><span class="num">2.</span> In Replit, open <strong>Secrets</strong> (🔒 icon in the left sidebar)</p>
    <p class="step"><span class="num">3.</span> Find <strong>GOOGLE_REFRESH_TOKEN</strong> → click Edit → paste → Save</p>
    <p class="step"><span class="num">4.</span> The API server will restart automatically and calendar will work.</p>
  </div>
</div>
<script>
function copyToken() {
  navigator.clipboard.writeText(document.getElementById('token').textContent);
  document.getElementById('ok').style.display = 'inline';
  setTimeout(() => document.getElementById('ok').style.display = 'none', 2000);
}
</script>
</body>
</html>`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.send(`<pre style="font-family:monospace;padding:2rem;background:#111;color:#f66">Error exchanging code: ${msg}</pre>`);
  }
});

export default router;
