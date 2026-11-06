
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

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
      return new Response(null, { status: 204, headers: cors });
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/health")
    ) {
      return reply({
        ok: true,
        service: "AI Tool Maker Pro 9",
        provider: "Cloudflare Workers AI",
        endpoint: "/api/chat"
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/tools/")) {
      if (!env.TOOL_BUCKET) {
        return reply({ error: "TOOL_BUCKET binding missing" }, 500);
      }

      const id = url.pathname.split("/")[2];

      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return reply({ error: "Invalid tool ID" }, 400);
      }

      try {
        const file = await env.TOOL_BUCKET.get(`tools/${id}/index.html`);

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

    if (!["/api/chat", "/api/create"].includes(url.pathname)) {
      return reply({ error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return reply({ error: "Use POST method" }, 405);
    }

    if (!env.AI) {
      return reply({
        error: "Cloudflare AI binding missing. Binding name must be AI."
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return reply({ error: "Invalid JSON request" }, 400);
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
Understand user requirements carefully.
Continue conversations using any supplied conversation history.
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
      const messages = [
        { role: "system", content: systemMessage }
      ];

      if (Array.isArray(body.history)) {
        for (const item of body.history.slice(-10)) {
          if (
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
          ) {
            messages.push({
              role: item.role,
              content: item.content
            });
          }
        }
      }

      messages.push({
        role: "user",
        content: prompt
      });

      const result = await env.AI.run(MODEL, {
        messages,
        max_tokens: 7000,
        temperature: 0.35
      });

      let output = String(result?.response || "").trim();

      if (!output) {
        return reply({
          error: "Cloudflare AI returned an empty answer"
        }, 502);
      }

      let toolId = null;
      let publicUrl = null;

      const match = output.match(
        /```(?:html)?\s*([\s\S]*?)```/i
      );

      const html = match ? match[1].trim() : output.trim();

      const isHTML =
        /<!doctype\s+html/i.test(html) ||
        (/<html[\s>]/i.test(html) && /<\/html>/i.test(html));

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
          "\n\nTool saved successfully!\nLive link: " + publicUrl;
      }

      return reply({
        success: true,
        output,
        toolId,
        publicUrl
      });

    } catch (error) {
      return reply({
        error: "Cloudflare Worker AI request failed",
        details: error.message || String(error)
      }, 500);
    }
  }
};
