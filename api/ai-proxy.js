/**
 * Vercel Serverless Function: AI Proxy
 * Forwards requests to Anthropic API server-side so the API key
 * never appears in browser code / DevTools.
 *
 * Usage (client):  fetch("/api/ai-proxy", { method: "POST", body: JSON.stringify({...}) })
 * Env var required: ANTHROPIC_API_KEY  (set in Vercel project settings)
 */
module.exports = async (req, res) => {
  const ALLOWED_MODELS = new Set(["claude-sonnet-4-5"]);
  const MAX_ALLOWED_TOKENS = 1200;
  const MAX_MESSAGES = 4;
  const MAX_MESSAGE_CHARS = 4000;
  const MAX_TOTAL_CHARS = 8000;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server." });
  }

  try {
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingMessages = Array.isArray(rawBody.messages) ? rawBody.messages : [];
    if (incomingMessages.length === 0) {
      return res.status(400).json({ error: "messages is required" });
    }

    const messageCharCount = incomingMessages.reduce((sum, msg) => sum + String(msg?.content || "").length, 0);
    if (messageCharCount > MAX_TOTAL_CHARS) {
      return res.status(413).json({ error: "Prompt too large" });
    }

    const safeModel = ALLOWED_MODELS.has(rawBody.model) ? rawBody.model : "claude-sonnet-4-5";
    const requestedMaxTokens = Number.parseInt(rawBody.max_tokens, 10);
    const safeMaxTokens = Number.isFinite(requestedMaxTokens)
      ? Math.min(Math.max(requestedMaxTokens, 64), MAX_ALLOWED_TOKENS)
      : 800;
    const safeMessages = incomingMessages
      .slice(0, MAX_MESSAGES)
      .map((msg) => ({
        role: msg?.role === "assistant" ? "assistant" : "user",
        content: String(msg?.content || "").slice(0, MAX_MESSAGE_CHARS),
      }));

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: safeMaxTokens,
        messages: safeMessages,
      }),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(502).json({ error: "Upstream AI request failed.", detail: e?.message });
  }
};
