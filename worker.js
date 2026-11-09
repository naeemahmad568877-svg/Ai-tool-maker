
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    };

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8"
        }
      });

    const kv = env.TOOLS_KV || env.AI_TOOLS;

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    // HEALTH CHECK
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        ok: true,
        message: "AI Tool Maker Pro 10 Backend Running",
        ai: !!env.AI,
        toolsKV: !!kv,
        model: "@cf/google/gemma-4-26b-a4b-it",
        bindingDetectedAs: env.TOOLS_KV
          ? "TOOLS_KV"
          : env.AI_TOOLS
            ? "AI_TOOLS"
            : null
      });
    }

    // AI CHAT
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        if (!env.AI) {
          return json({
            ok: false,
            error: "Cloudflare AI binding AI missing."
          }, 500);
        }

        const body = await request.json();

        const prompt = String(
          body.prompt || body.message || body.input || ""
        ).trim();

        if (!prompt) {
          return json({
            ok: false,
            error: "Prompt خالی ہے۔"
          }, 400);
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "system",
                content: `You are AI Tool Maker Pro 10, an expert application and web tool builder.

Your job is to create complete, working tools from user prompts.

IMPORTANT RULES:
1. Generate complete HTML documents.
2. Include HTML, CSS and JavaScript in the same document.
3. Make all buttons and features functional.
4. Make the design modern, responsive and mobile friendly.
5. Do not return incomplete code.
6. Do not use placeholder functionality.
7. Use working JavaScript.
8. Use Urdu or the language requested by the user.
9. Return the complete HTML code.
10. Do not add unnecessary explanations.
11. Start the generated application with <!DOCTYPE html>.
12. Never claim that an external AI API, video generator, payment system or backend is working unless it is actually integrated.
13. If a requested feature needs an external API, clearly indicate what connection is required.`
              },
              {
                role: "user",
                content: prompt
              }
            ],
            chat_template_kwargs: {
              enable_thinking: false
            },
            max_completion_tokens: 4096
          }
        );

        // EXTRACT AI RESPONSE
        let output = "";

        if (typeof result === "string") {
          output = result;
        } else if (typeof result?.response === "string") {
          output = result.response;
        } else if (
          typeof result?.choices?.[0]?.message?.content === "string"
        ) {
          output = result.choices[0].message.content;
        } else if (
          typeof result?.result?.response === "string"
        ) {
          output = result.result.response;
        } else if (
          typeof result?.output_text === "string"
        ) {
          output = result.output_text;
        } else if (
          Array.isArray(result?.content)
        ) {
          output = result.content
            .map(item => item.text || "")
            .join("\n");
        }

        output = String(output || "").trim();

        // REMOVE MARKDOWN CODE FENCES
        output = output
          .replace(/^```(?:html)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

        if (!output) {
          return json({
            ok: false,
            error: "AI نے خالی جواب دیا۔",
            detail: JSON.stringify(result).slice(0, 2000)
          }, 502);
        }

        return json({
          ok: true,
          output: output,
          response: output,
          text: output,
          model: "@cf/google/gemma-4-26b-a4b-it"
        });

      } catch (error) {
        return json({
          ok: false,
          error: "AI request failed",
          detail: error.message || String(error)
        }, 500);
      }
    }

    // TOOL STORAGE ROUTES
    if (
      url.pathname === "/api/tools" ||
      url.pathname.startsWith("/api/tools/")
    ) {
      if (!kv) {
        return json({
          ok: false,
          error: "KV Binding missing. TOOLS_KV یا AI_TOOLS Namespace جوڑیں۔"
        }, 500);
      }

      // CREATE TOOL
      if (
        url.pathname === "/api/tools" &&
        request.method === "POST"
      ) {
        try {
          const body = await request.json();

          const name = String(body.name || "AI Tool").trim();
          const description = String(body.description || "").trim();
          const html = String(body.html || "").trim();

          if (!/<html[\s>]/i.test(html)) {
            return json({
              ok: false,
              error: "درست HTML Tool موصول نہیں ہوا۔"
            }, 400);
          }

          const id = "tool_" + crypto.randomUUID();
          const now = new Date().toISOString();

          const tool = {
            id,
            name,
            description,
            html,
            createdAt: now,
            updatedAt: now
          };

          await kv.put(
            "tool:" + id,
            JSON.stringify(tool)
          );

          const publicUrl =
            `${url.origin}/tool/${encodeURIComponent(id)}`;

          return json({
            ok: true,
            id,
            tool,
            url: publicUrl,
            publicUrl
          }, 201);

        } catch (error) {
          return json({
            ok: false,
            error: "Tool save failed",
            detail: error.message || String(error)
          }, 500);
        }
      }

      // EXTRACT TOOL ID
      let id = "";

      try {
        id = decodeURIComponent(
          url.pathname.slice("/api/tools/".length)
        ).trim();
      } catch {
        return json({
          error: "Invalid Tool ID."
        }, 400);
      }

      if (!id || id.includes("/")) {
        return json({
          error: "Tool ID غلط ہے۔"
        }, 400);
      }

      // GET TOOL
      if (request.method === "GET") {
        try {
          const value = await kv.get("tool:" + id);

          if (!value) {
            return json({
              ok: false,
              error: "Tool نہیں ملا۔"
            }, 404);
          }

          const tool = JSON.parse(value);

          const publicUrl =
            `${url.origin}/tool/${encodeURIComponent(id)}`;

          return json({
            ok: true,
            id,
            tool,
            url: publicUrl,
            publicUrl
          });

        } catch (error) {
          return json({
            ok: false,
            error: "Tool fetch failed",
            detail: error.message || String(error)
          }, 500);
        }
      }

      // UPDATE TOOL
      if (request.method === "PUT") {
        try {
          const value = await kv.get("tool:" + id);

          if (!value) {
            return json({
              ok: false,
              error: "Tool نہیں ملا۔"
            }, 404);
          }

          const oldTool = JSON.parse(value);
          const body = await request.json();

          const updatedTool = {
            ...oldTool,
            name: String(body.name ?? oldTool.name),
            description: String(
              body.description ?? oldTool.description
            ),
            html: String(body.html ?? oldTool.html),
            updatedAt: new Date().toISOString()
          };

          if (!/<html[\s>]/i.test(updatedTool.html)) {
            return json({
              ok: false,
              error: "Updated HTML درست نہیں۔"
            }, 400);
          }

          await kv.put(
            "tool:" + id,
            JSON.stringify(updatedTool)
          );

          const publicUrl =
            `${url.origin}/tool/${encodeURIComponent(id)}`;

          return json({
            ok: true,
            id,
            tool: updatedTool,
            url: publicUrl,
            publicUrl
          });

        } catch (error) {
          return json({
            ok: false,
            error: "Tool update failed",
            detail: error.message || String(error)
          }, 500);
        }
      }

      return json({
        ok: false,
        error: "Method not allowed"
      }, 405);
    }

    // PUBLIC TOOL
    if (
      url.pathname.startsWith("/tool/") &&
      request.method === "GET"
    ) {
      try {
        if (!kv) {
          return new Response(
            "KV Binding missing",
            { status: 500 }
          );
        }

        const id = decodeURIComponent(
          url.pathname.slice("/tool/".length)
        );

        if (!id || id.includes("/")) {
          return new Response(
            "Invalid Tool ID",
            { status: 400 }
          );
        }

        const value = await kv.get("tool:" + id);

        if (!value) {
          return new Response(
            "Tool نہیں ملا۔",
            { status: 404 }
          );
        }

        const tool = JSON.parse(value);

        return new Response(tool.html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "frame-ancestors *"
          }
        });

      } catch (error) {
        return new Response(
          "Tool Error: " + (error.message || String(error)),
          { status: 500 }
        );
      }
    }

    return json({
      ok: false,
      error: "Route not found"
    }, 404);
  }
};
