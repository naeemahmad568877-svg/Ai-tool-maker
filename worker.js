
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

// AI response ko mukhtalif formats se read karna
function extractText(result) {
  if (typeof result === "string") {
    return result.trim();
  }

  if (!result || typeof result !== "object") {
    return "";
  }

  const candidates = [
    result.response,
    result.output,
    result.text,
    result.content,
    result.result?.response,
    result.result?.output,
    result.choices?.[0]?.message?.content,
    result.choices?.[0]?.text
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const text = value.map(item => {
        if (typeof item === "string") return item;
        return item?.text || "";
      }).join("").trim();

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

    // Health check
    if (
      request.method === "GET" &&
      (path === "/" || path === "/health")
    ) {
      return reply({
        success: true,
        service: "AI Tool Maker Pro 9",
        provider: "Cloudflare Workers AI",
        model: MODEL,
        binding: "AI",
        endpoint: "/api/chat",
        status: "Running"
      });
    }

    // Saved tools
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
            "Cache-Control": "no-store"
          }
        });

      } catch (error) {
        return reply({
          error: "Storage error",
          details: error.message
        }, 500);
      }
    }

    // API routes
    if (!["/api/chat", "/api/create"].includes(path)) {
      return reply({
        error: "API route not found",
        path
      }, 404);
    }

    if (request.method !== "POST") {
      return reply({
        error: "Use POST method"
      }, 405);
    }

    // Check Cloudflare AI binding
    if (!env.AI) {
      return reply({
        error: "Cloudflare AI binding missing",
        instruction: "Binding name must be AI"
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

    // Main AI instructions
    const systemMessage = `
You are AI Tool Maker Pro 9.

You are a powerful universal AI tool builder.

Understand Urdu, Roman Urdu and English.

You can build:
- HTML websites
- Video creator interfaces
- Calculators
- Business tools
- Educational applications
- Games
- Productivity tools
- AI chatbots
- Translators
- Image tools
- Audio tools
- Code generators
- Forms and dashboards
- Any other requested software.

Understand the user's complete requirements.

Ask only one important question if necessary.

When enough information is available,
create a complete working application.

For actual tool requests:
- Generate complete standalone HTML.
- Include CSS and JavaScript.
- Make buttons functional.
- Make design mobile responsive.
- Use modern professional UI.
- Include all requested features.
- Return HTML inside one html code fence.

For normal questions, answer normally.

Never invent API keys or live links.

Never put private API keys in browser code.

Explain when external services are required.

Reply in ${language}.
`;

    try {
      const messages = [
        {
          role: "system",
          content: systemMessage
        }
      ];

      // Previous conversation
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

      // Run Cloudflare Workers AI
      const result = await env.AI.run(MODEL, {
        messages,
        max_completion_tokens: 7000,
        temperature: 0.35,
        chat_template_kwargs: {
          enable_thinking: false
        }
      });

      const output = extractText(result);

      // Better error information
      if (!output) {
        return reply({
          success: false,
          error: "AI returned an empty answer",
          model: MODEL,
          binding: "AI",
          responseType: typeof result,
          responseKeys:
            result && typeof result === "object"
              ? Object.keys(result)
              : [],
          responsePreview: JSON.stringify(result).slice(0, 2000)
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

      // Save HTML to Cloudflare R2
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
        model: MODEL,
        binding: "AI"
      }, 500);
    }
  }
};
