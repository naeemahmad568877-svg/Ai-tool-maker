
const MODEL = "@cf/zai-org/glm-4.7-flash";

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

// مختلف Cloudflare AI response formats سے جواب حاصل کریں
function extractText(result) {
  const candidates = [
    result?.response,
    result?.choices?.[0]?.message?.content,
    result?.result?.response,
    result?.output
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const text = value
        .map(item => typeof item === "string"
          ? item
          : item?.text || "")
        .join("")
        .trim();

      if (text) return text;
    }
  }

  return "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    // Backend health check
    if (
      request.method === "GET" &&
      (path === "/" || path === "/health")
    ) {
      return reply({
        ok: true,
        service: "AI Tool Maker Pro 9",
        provider: "Cloudflare Workers AI",
        model: MODEL,
        endpoint: "/api/chat"
      });
    }

    // Saved tools access
    if (
      request.method === "GET" &&
      path.startsWith("/tools/")
    ) {
      if (!env.TOOL_BUCKET) {
        return reply({
          error: "TOOL_BUCKET binding missing"
        }, 500);
      }

      const id = path.split("/")[2];

      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        return reply({
          error: "Invalid tool ID"
        }, 400);
      }

      try {
        const file = await env.TOOL_BUCKET.get(
          `tools/${id}/index.html`
        );

        if (!file) {
          return reply({
            error: "Tool not found"
          }, 404);
        }

        return new Response(file.body, {
          headers: {
            ...cors,
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        });
      } catch (error) {
        return reply({
          error: "Storage error",
          details: error.message
        }, 500);
      }
    }

    // AI API routes
    if (!["/api/chat", "/api/create"].includes(path)) {
      return reply({
        error: "Not found"
      }, 404);
    }

    if (request.method !== "POST") {
      return reply({
        error: "Use POST method"
      }, 405);
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
      return reply({
        error: "Invalid JSON request"
      }, 400);
    }

    const prompt = String(
      body.prompt || body.message || body.input || ""
    ).trim();

    const language = String(body.language || "Urdu");

    if (!prompt) {
      return reply({
        error: "Prompt required"
      }, 400);
    }

    if (prompt.length > 30000) {
      return reply({
        error: "Prompt is too long"
      }, 413);
    }

    const systemMessage = `
You are AI Tool Maker Pro 9.

You are a professional universal AI software,
website and application builder.

Understand Urdu, Roman Urdu and English.

Understand the user's requirements carefully.

You can create:
- HTML websites
- Web applications
- Calculators
- Business tools
- Educational tools
- Games
- Productivity tools
- AI interfaces
- Forms and dashboards
- Other requested software tools

Do not restrict users to calculators or video creators.

Continue conversations using supplied history.

Ask only one important question if essential information is missing.

When enough details are available, create a complete,
responsive and functional HTML application.

Include HTML, CSS and JavaScript in one standalone HTML file.

Make all requested buttons and features functional.

Use mobile-friendly responsive design.

Never put private API keys in browser code.

Never invent a published URL.

If a feature requires an external service,
explain its configuration.

Return complete HTML inside one html code fence
when the user requests an actual tool.

For ordinary questions, answer normally.

Reply in ${language}.
`;

    try {
      const messages = [
        {
          role: "system",
          content: systemMessage
        }
      ];

      // Conversation history
      if (Array.isArray(body.history)) {
        for (const item of body.history.slice(-12)) {
          if (
            item &&
            ["user", "assistant"].includes(item.role) &&
            typeof item.content === "string"
          ) {
            messages.push({
              role: item.role,
              content: item.content.slice(0, 12000)
            });
          }
        }
      }

      messages.push({
        role: "user",
        content: prompt
      });

      // Cloudflare Workers AI
      const result = await env.AI.run(MODEL, {
        messages,
        max_tokens: 7000,
        temperature: 0.35
      });

      const output = extractText(result);

      if (!output) {
        return reply({
          success: false,
          error: "AI returned an empty answer",
          model: MODEL,
          responseKeys: result && typeof result === "object"
            ? Object.keys(result)
            : []
        }, 502);
      }

      let toolId = null;
      let publicUrl = null;

      // Find generated HTML
      const match = output.match(
        /```(?:html)?\s*([\s\S]*?)```/i
      );

      const html = match
        ? match[1].trim()
        : output.trim();

      const isHTML =
        /<!doctype\s+html/i.test(html) ||
        (
          /<html[\s>]/i.test(html) &&
          /<\/html>/i.test(html)
        );

      // Save generated tool to Cloudflare R2
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
      }

      let finalOutput = output;

      if (publicUrl) {
        finalOutput +=
          "\n\nYour tool has been saved!\nLive link: " +
          publicUrl;
      }

      return reply({
        success: true,
        output: finalOutput,
        toolId,
        publicUrl,
        provider: "Cloudflare Workers AI",
        model: MODEL
      });

    } catch (error) {
      return reply({
        success: false,
        error: "Cloudflare Worker AI request failed",
        details: error.message || String(error),
        model: MODEL
      }, 500);
    }
  }
};
