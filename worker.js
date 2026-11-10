
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store"
    };

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }

    function error(message, status = 500, detail = "") {
      return json({
        ok: false,
        error: message,
        detail: String(detail || "")
      }, status);
    }

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
        message: "AI Tool Maker Pro Backend Running",
        ai: !!env.AI,
        toolsKV: !!env.TOOLS_KV,
        model: MODEL,
        version: "11.0"
      });
    }

    // AI CHAT
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return error("Method not allowed", 405);
      }

      try {
        if (!env.AI) {
          return error("AI binding missing. Cloudflare AI binding check karein.", 500);
        }

        const body = await request.json();
        const prompt = String(
          body.prompt || body.message || ""
        ).trim();

        const language = String(body.language || "Urdu");

        if (!prompt) {
          return error("Prompt خالی ہے۔", 400);
        }

        const result = await env.AI.run(MODEL, {
          messages: [
            {
              role: "system",
              content: `You are an expert professional web application developer.

Create complete and functional web applications.

Requirements:
- Return a complete HTML document.
- Include HTML, CSS and JavaScript.
- Make the application responsive.
- Make all buttons functional.
- Use modern professional UI.
- Do not create fake API integrations.
- Do not expose API keys.
- Preserve all existing requested functionality.
- Use the requested language: ${language}.
- Return the complete HTML inside one html code fence.
- Do not add explanations outside the code fence.`
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 4096
        });

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
        }

        output = String(output || "").trim();

        if (!output) {
          return error(
            "AI نے خالی جواب دیا۔",
            502,
            JSON.stringify(result).slice(0, 2000)
          );
        }

        return json({
          ok: true,
          output: output,
          response: output,
          text: output
        });

      } catch (e) {
        return error(
          "AI request failed",
          500,
          e.message || String(e)
        );
      }
    }

    // TOOLS API
    if (
      url.pathname === "/api/tools" ||
      url.pathname.startsWith("/api/tools/")
    ) {
      if (!env.TOOLS_KV) {
        return error(
          "TOOLS_KV binding missing. Cloudflare KV connect karein.",
          500
        );
      }

      // CREATE TOOL
      if (
        url.pathname === "/api/tools" &&
        request.method === "POST"
      ) {
        try {
          const body = await request.json();

          const html = String(body.html || "").trim();

          if (
            !html ||
            !(/<!doctype\s+html/i.test(html) ||
              /<html[\s>]/i.test(html))
          ) {
            return error("درست HTML Tool موصول نہیں ہوا۔", 400);
          }

          const id = "tool_" + crypto.randomUUID();
          const now = new Date().toISOString();

          const tool = {
            id,
            name: String(body.name || "AI Tool"),
            description: String(body.description || ""),
            html,
            createdAt: now,
            updatedAt: now
          };

          await env.TOOLS_KV.put(
            "tool:" + id,
            JSON.stringify(tool)
          );

          const publicUrl =
            url.origin + "/tool/" + encodeURIComponent(id);

          return json({
            ok: true,
            id,
            tool,
            url: publicUrl,
            publicUrl
          }, 201);

        } catch (e) {
          return error(
            "Tool save failed",
            500,
            e.message || String(e)
          );
        }
      }

      // GET / UPDATE TOOL
      let id;

      try {
        id = decodeURIComponent(
          url.pathname.slice("/api/tools/".length)
        ).trim();
      } catch {
        return error("Invalid Tool ID", 400);
      }

      if (!id || id.includes("/")) {
        return error("Tool ID غلط ہے۔", 400);
      }

      const key = "tool:" + id;

      // GET TOOL
      if (request.method === "GET") {
        try {
          const value = await env.TOOLS_KV.get(key);

          if (!value) {
            return error("Tool نہیں ملا۔", 404);
          }

          const tool = JSON.parse(value);

          const publicUrl =
            url.origin + "/tool/" + encodeURIComponent(id);

          return json({
            ok: true,
            id,
            tool,
            url: publicUrl,
            publicUrl
          });

        } catch (e) {
          return error(
            "Tool fetch failed",
            500,
            e.message || String(e)
          );
        }
      }

      // UPDATE TOOL
      if (request.method === "PUT") {
        try {
          const value = await env.TOOLS_KV.get(key);

          if (!value) {
            return error("Tool نہیں ملا۔", 404);
          }

          const old = JSON.parse(value);
          const body = await request.json();

          const html = String(body.html ?? old.html);

          if (
            !html ||
            !(/<!doctype\s+html/i.test(html) ||
              /<html[\s>]/i.test(html))
          ) {
            return error("Updated HTML درست نہیں۔", 400);
          }

          const updated = {
            ...old,
            name: String(body.name ?? old.name),
            description: String(
              body.description ?? old.description
            ),
            html,
            updatedAt: new Date().toISOString()
          };

          await env.TOOLS_KV.put(
            key,
            JSON.stringify(updated)
          );

          const publicUrl =
            url.origin + "/tool/" + encodeURIComponent(id);

          return json({
            ok: true,
            id,
            tool: updated,
            url: publicUrl,
            publicUrl
          });

        } catch (e) {
          return error(
            "Tool update failed",
            500,
            e.message || String(e)
          );
        }
      }

      return error("Method not allowed", 405);
    }

    // PUBLIC TOOL
    if (
      url.pathname.startsWith("/tool/") &&
      request.method === "GET"
    ) {
      try {
        if (!env.TOOLS_KV) {
          return new Response("TOOLS_KV binding missing", {
            status: 500
          });
        }

        let id;

        try {
          id = decodeURIComponent(
            url.pathname.slice("/tool/".length)
          ).trim();
        } catch {
          return new Response("Invalid Tool ID", {
            status: 400
          });
        }

        if (!id || id.includes("/")) {
          return new Response("Invalid Tool ID", {
            status: 400
          });
        }

        const value = await env.TOOLS_KV.get("tool:" + id);

        if (!value) {
          return new Response("Tool نہیں ملا۔", {
            status: 404
          });
        }

        const tool = JSON.parse(value);

        return new Response(tool.html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "frame-ancestors *"
          }
        });

      } catch (e) {
        return new Response(
          "Public Tool Error: " + (e.message || String(e)),
          { status: 500 }
        );
      }
    }

    return error("Route not found: " + url.pathname, 404);
  }
};
