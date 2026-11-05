
const HF_URL = "https://router.huggingface.co/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b:fastest";

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    const reply = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return reply({ ok: true, service: "AI Tool Maker Pro 8.1" });
    }

    if (url.pathname !== "/api/chat" || request.method !== "POST") {
      return reply({ error: "Not found" }, 404);
    }

    if (!env.HF_TOKEN) {
      return reply({ error: "HF_TOKEN Secret missing in Cloudflare" }, 500);
    }

    try {
      const body = await request.json();
      const prompt = String(body.prompt || "").trim();
      const language = String(body.language || "Urdu");

      if (!prompt) return reply({ error: "Please enter a prompt" }, 400);
      if (prompt.length > 8000) return reply({ error: "Prompt too long" }, 413);

      const response = await fetch(HF_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.HF_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content: `You are AI Tool Maker Pro 8.1. Understand Urdu and Roman Urdu. Reply in ${language}. Help create tools and apps. Provide practical code when requested.`
            },
            { role: "user", content: prompt }
          ],
          max_tokens: 1800,
          temperature: 0.6
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return reply({
          error: data.error?.message || data.error || "Hugging Face API error"
        }, 502);
      }

      const output = data.choices?.[0]?.message?.content;
      if (!output) return reply({ error: "AI returned an empty response" }, 502);

      return reply({ output });

    } catch (error) {
      return reply({ error: error.message || "Server error" }, 500);
    }
  }
};
