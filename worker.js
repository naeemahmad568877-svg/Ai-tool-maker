
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Backend health
    if (url.pathname === "/api/health") {
      return json({
        success: true,
        aiBinding: !!env.AI,
        storageBinding: !!env.TOOLS_BUCKET
      });
    }

    // Permanent public tool page
    if (request.method === "GET" &&
        url.pathname.startsWith("/tools/")) {

      const id = url.pathname.split("/")[2];

      if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
        return new Response("Invalid tool link", {
          status: 400
        });
      }

      if (!env.TOOLS_BUCKET) {
        return new Response("R2 storage is not configured", {
          status: 500
        });
      }

      const file = await env.TOOLS_BUCKET.get(id + ".html");

      if (!file) {
        return new Response("Tool not found", {
          status: 404
        });
      }

      return new Response(file.body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }

    // Automatic AI Tool Creator
    if (url.pathname === "/api/create" &&
        request.method === "POST") {

      if (!env.AI) {
        return json({
          success: false,
          error: "Cloudflare AI binding AI is missing"
        }, 500);
      }

      if (!env.TOOLS_BUCKET) {
        return json({
          success: false,
          error: "R2 binding TOOLS_BUCKET is missing"
        }, 500);
      }

      try {
        const body = await request.json();
        const prompt = String(body.prompt || "").trim();

        if (!prompt) {
          return json({
            success: false,
            error: "Please write your tool idea"
          }, 400);
        }

        if (prompt.length > 12000) {
          return json({
            success: false,
            error: "Prompt is too long"
          }, 400);
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "system",
                content: `You are AI Tool Maker Pro 9.
You build complete, professional, working web applications.

Create a complete standalone HTML application from the user's request.

Requirements:
- Return ONLY HTML code.
- Start with <!DOCTYPE html>.
- End with </html>.
- Include HTML, CSS and JavaScript in one file.
- Make it responsive for mobile and desktop.
- Make all requested features functional.
- Use a professional modern design.
- Do not return a plan or explanation.
- Do not use Markdown or code fences.
- Do not create a calculator unless explicitly requested.
- Never claim that external APIs or services work unless implemented.
- If a feature requires an external API key or service, clearly explain that inside the generated app.
- Use the language requested by the user, or infer it from their prompt.`
              },
              {
                role: "user",
                content: prompt
              }
            ],
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        );

        let html =
          result?.response ||
          result?.output ||
          result?.answer ||
          result?.choices?.[0]?.message?.content ||
          "";

        if (typeof html !== "string") {
          html = JSON.stringify(html);
        }

        html = html.trim()
          .replace(/^```(?:html)?\s*/i, "")
          .replace(/\s*```$/, "");

        const start = html.search(/<!doctype\s+html/i);

        if (start >= 0) {
          html = html.slice(start);
        }

        const end = html.toLowerCase().lastIndexOf("</html>");

        if (end >= 0) {
          html = html.slice(0, end + 7);
        }

        if (
          !/<!doctype\s+html/i.test(html) ||
          !/<html[\s>]/i.test(html) ||
          !/<\/html>/i.test(html)
        ) {
          return json({
            success: false,
            error: "AI did not return complete HTML. Please try again."
          }, 502);
        }

        if (html.length > 2 * 1024 * 1024) {
          return json({
            success: false,
            error: "Generated HTML is too large"
          }, 413);
        }

        // Create unique permanent ID
        const id = crypto.randomUUID();

        // Save HTML in Cloudflare R2
        await env.TOOLS_BUCKET.put(
          id + ".html",
          html,
          {
            httpMetadata: {
              contentType: "text/html; charset=utf-8"
            },
            customMetadata: {
              createdAt: new Date().toISOString()
            }
          }
        );

        const publicUrl =
          url.origin + "/tools/" + id;

        return json({
          success: true,
          message: "Your AI tool was created and published",
          id,
          publicUrl,
          html,
          size: html.length
        });

      } catch (error) {
        return json({
          success: false,
          error: error.message || "Tool creation failed"
        }, 500);
      }
    }

    // Old chat endpoint remains available
    if (url.pathname === "/api/chat" &&
        request.method === "POST") {

      if (!env.AI) {
        return json({
          success: false,
          error: "AI binding missing"
        }, 500);
      }

      try {
        const body = await request.json();
        const prompt = String(body.prompt || "").trim();

        if (!prompt) {
          return json({
            success: false,
            error: "Prompt required"
          }, 400);
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "system",
                content: "You are a helpful AI assistant."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        );

        const output =
          result?.response ||
          result?.output ||
          result?.answer ||
          "";

        return json({
          success: true,
          output,
          answer: output,
          response: output
        });

      } catch (error) {
        return json({
          success: false,
          error: error.message
        }, 500);
      }
    }

    // Website files
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({
      success: false,
      error: "Assets binding missing"
    }, 500);
  }
};
