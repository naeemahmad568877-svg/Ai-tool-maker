const HF_URL = "https://router.huggingface.co/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b:fastest";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/health")
    ) {
      return reply({
        ok: true,
        service: "AI Tool Maker Pro 9",
        endpoint: "/api/chat"
      });
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/tools/")
    ) {
      if (!env.TOOL_BUCKET) {
        return reply({ error: "TOOL_BUCKET binding missing" }, 500);
      }

      const id = url.pathname.split("/")[2];

      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return reply({ error: "Invalid tool ID" }, 400);
      }

      try {
        const file = await env.TOOL_BUCKET.get(
          `tools/${id}/index.html`
        );

        if (!file) {
          return reply({ error: "Tool not found" }, 404);
        }

        return new Response(file.body, {
          headers: {
            ...cors,
            "Content-Type": "text/html; charset=utf-8"
          }
        });
      } catch (error) {
        return reply({
          error: error.message || "Storage error"
        }, 500);
      }
    }

    if (
      !["/api/chat", "/api/create"].includes(url.pathname)
    ) {
      return reply({ error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return reply({ error: "Use POST method" }, 405);
    }

    if (!env.HF_TOKEN) {
      return reply({
        error: "HF_TOKEN Secret missing"
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return reply({
        error: "Invalid JSON request"
      }, 400);
    }

    const prompt = String(body.prompt || "").trim();
    const language = body.language || "Urdu";

    if (!prompt) {
      return reply({ error: "Prompt required" }, 400);
    }

    const systemMessage = `
You are AI Tool Maker Pro 9.
You are a universal AI software and website builder.
Understand Urdu, Roman Urdu and English.
Understand user requirements.
Continue the conversation using its history.
Ask one important question if necessary.
When enough details are available, create a complete responsive HTML application.
Include CSS and JavaScript in one HTML file.
Do not restrict users to calculators or video creators.
Make all requested buttons functional.
Return complete HTML inside one html code fence.
Never put private API keys in browser code.
Never invent a published URL.
Reply in ${language}.
`;

    try {
      const ai = await fetch(HF_URL, {
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
              content: systemMessage
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 7000,
          temperature: 0.35
        })
      });

      const raw = await ai.text();
      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        return reply({
          error: "Hugging Face invalid response",
          details: raw.slice(0, 1000)
        }, 502);
      }

      if (!ai.ok) {
        return reply({
          error:
            data.error?.message ||
            data.error ||
            data.message ||
            "Hugging Face AI error",
          upstreamStatus: ai.status
        }, 502);
      }

      let output =
        data.choices?.[0]?.message?.content || "";

      if (Array.isArray(output)) {
        output = output.map(item =>
          typeof item === "string"
            ? item
            : item.text || ""
        ).join("\n");
      }

      output = String(output).trim();

      if (!output) {
        return reply({
          error: "AI returned empty answer"
        }, 502);
      }

      let toolId = null;
      let publicUrl = null;

      const match = output.match(
        /```(?:html)?\s*([\s\S]*?)```/i
      );

      const html = match
        ? match[1].trim()
        : output.trim();

      const isHTML =
        /<!doctype\s+html/i.test(html) ||
        (/<html[\s>]/i.test(html) &&
         /<\/html>/i.test(html));

      if (isHTML && env.TOOL_BUCKET) {
        toolId = crypto.randomUUID()
          .replace(/-/g, "")
          .slice(0, 16);

        await env.TOOL_BUCKET.put(
          `tools/${toolId}/index.html`,
          html,
          {
            httpMetadata: {
              contentType: "text/html; charset=utf-8"
            }
          }
        );

        publicUrl = `${url.origin}/tools/${toolId}`;

        output +=
          "\n\nTool saved successfully!\nLive link: " +
          publicUrl;
      }

      return reply({
        success: true,
        output,
        toolId,
        publicUrl
      });

    } catch (error) {
      return reply({
        error: "Worker AI request failed",
        details: error.message || String(error)
      }, 500);
    }
  }
};