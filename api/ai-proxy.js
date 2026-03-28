/**
 * Vercel Serverless Function: AI Proxy
 * Forwards requests to Anthropic API server-side so the API key
 * never appears in browser code / DevTools.
 *
 * Usage (client):  fetch("/api/ai-proxy", { method: "POST", body: JSON.stringify({...}) })
 * Env var required: ANTHROPIC_API_KEY  (set in Vercel project settings)
 */
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server." });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: "Upstream AI request failed.", detail: e?.message });
  }
};
