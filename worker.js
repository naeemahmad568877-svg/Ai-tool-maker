const MODEL = "@cf/google/gemma-4-26b-a4b-it";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store"
    };

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          ...headers,
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }

    function htmlResponse(content, status = 200) {
      return new Response(content, {
        status,
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "frame-ancestors *"
        }
      });
    }

    function errorResponse(error, status = 500, detail = "") {
      return json({
        ok: false,
        error,
        detail: String(detail || "").slice(0, 2000)
      }, status);
    }

    async function readBody() {
      try {
        return await request.json();
      } catch {
        throw new Error("درست JSON درخواست موصول نہیں ہوئی۔");
      }
    }

    function getAIOutput(result) {
      if (typeof result === "string") return result;

      if (typeof result?.response === "string") {
        return result.response;
      }

      if (typeof result?.output_text === "string") {
        return result.output_text;
      }

      if (typeof result?.result?.response === "string") {
        return result.result.response;
      }

      if (
        typeof result?.choices?.[0]?.message?.content === "string"
      ) {
        return result.choices[0].message.content;
      }

      if (Array.isArray(result?.content)) {
        return result.content
          .map(item => item?.text || "")
          .join("\n");
      }

      return "";
    }

    // AI کے جواب کو صاف کر کے مکمل HTML نکالنا
    function cleanHTML(raw) {
      let html = String(raw || "").trim();

      if (!html) return "";

      // Markdown code fences ختم کریں
      html = html
        .replace(/^```html\s*/i, "")
        .replace(/^```HTML\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      // اگر جواب میں explanation پہلے آ گئی ہو تو <!DOCTYPE html> سے شروع کریں
      const doctypeIndex = html.search(/<!doctype\s+html>/i);

      if (doctypeIndex >= 0) {
        html = html.slice(doctypeIndex).trim();
      }

      // اگر مکمل <html> موجود ہے تو صرف مکمل document نکالیں
      const htmlStart = html.search(/<html[\s>]/i);
      const htmlEnd = html.search(/<\/html\s*>/i);

      if (htmlStart >= 0 && htmlEnd >= 0) {
        html = html.slice(
          doctypeIndex >= 0 ? 0 : htmlStart,
          htmlEnd + html.match(/<\/html\s*>/i)[0].length
        ).trim();

        // اگر doctype سے پہلے garbage نہیں ہے
        if (!/^<!doctype\s+html>/i.test(html)) {
          html = "<!DOCTYPE html>\n" + html;
        }
      }

      // آخری بار code fence صاف کریں
      html = html.replace(/^```[a-zA-Z]*\s*/i, "");
      html = html.replace(/\s*```$/i, "");

      return html.trim();
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    // =========================
    // HEALTH CHECK
    // =========================

    if (path === "/" && request.method === "GET") {
      return json({
        ok: true,
        message: "AI Tool Maker Pro 10 Backend Running",
        version: "3.0",
        ai: !!env.AI,
        toolsKV: !!env.TOOLS_KV,
        model: MODEL,
        routes: [
          "/api/chat",
          "/api/tools",
          "/tool/TOOL_ID"
        ]
      });
    }

    // =========================
    // AI CHAT
    // =========================

    if (path === "/api/chat" && request.method === "POST") {
      try {
        if (!env.AI) {
          return errorResponse(
            "Cloudflare AI binding missing.",
            500
          );
        }

        const body = await readBody();

        const prompt = String(
          body.prompt || body.message || ""
        ).trim();

        const language = String(
          body.language || "Urdu"
        );

        if (!prompt) {
          return errorResponse(
            "Prompt خالی ہے۔",
            400
          );
        }

        if (prompt.length > 30000) {
          return errorResponse(
            "Prompt بہت لمبا ہے۔",
            413
          );
        }

        const systemPrompt = `
You are AI Tool Maker Pro 10 International.

Create a complete working browser-based web application.

IMPORTANT RULES:

1. Return ONLY complete HTML.
2. Start with <!DOCTYPE html>.
3. Include complete HTML, CSS and JavaScript in ONE document.
4. The document MUST contain <html> and </html>.
5. Do not use markdown code fences.
6. Do not write explanations before or after the HTML.
7. Make the application responsive and mobile friendly.
8. Make buttons and requested features functional.
9. Do not invent fake API integrations.
10. Do not remove requested features.
11. Use the requested language: ${language}.
12. Return the FULL HTML DOCUMENT, not a partial snippet.
`;

        const result = await env.AI.run(MODEL, {
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: 8192
        });

        const rawOutput = getAIOutput(result);
        const output = cleanHTML(rawOutput);

        if (!output) {
          return errorResponse(
            "Cloudflare AI نے HTML جواب نہیں دیا۔",
            502,
            JSON.stringify(result)
          );
        }

        if (
          !/<html[\s>]/i.test(output) ||
          !/<\/html\s*>/i.test(output)
        ) {
          return errorResponse(
            "AI نے مکمل HTML document نہیں دیا۔",
            502,
            output.slice(0, 2000)
          );
        }

        return json({
          ok: true,
          output,
          response: output,
          text: output,
          html: output
        });

      } catch (error) {
        return errorResponse(
          "AI request failed",
          500,
          error.message || error
        );
      }
    }

    // =========================
    // TOOLS API
    // =========================

    const isToolsRoute =
      path === "/api/tools" ||
      path.startsWith("/api/tools/");

    if (isToolsRoute) {

      if (!env.TOOLS_KV) {
        return errorResponse(
          "TOOLS_KV binding missing. Cloudflare KV کو Worker سے جوڑیں۔",
          500
        );
      }

      // CREATE TOOL
      if (
        path === "/api/tools" &&
        request.method === "POST"
      ) {
        try {
          const body = await readBody();

          const html = cleanHTML(
            body.html || body.output || body.response || ""
          );

          if (
            !/<html[\s>]/i.test(html) ||
            !/<\/html\s*>/i.test(html)
          ) {
            return errorResponse(
              "درست مکمل HTML Tool موصول نہیں ہوا۔",
              400,
              html.slice(0, 2000)
            );
          }

          const id =
            "tool_" + crypto.randomUUID();

          const now =
            new Date().toISOString();

          const tool = {
            id,
            name: String(
              body.name || "AI Tool"
            ).slice(0, 150),

            description: String(
              body.description || ""
            ).slice(0, 1000),

            html,

            createdAt: now,
            updatedAt: now
          };

          await env.TOOLS_KV.put(
            "tool:" + id,
            JSON.stringify(tool)
          );

          const publicUrl =
            url.origin +
            "/tool/" +
            encodeURIComponent(id);

          return json({
            ok: true,
            id,
            tool,
            url: publicUrl,
            publicUrl
          }, 201);

        } catch (error) {
          return errorResponse(
            "Tool save failed",
            500,
            error.message || error
          );
        }
      }

      // TOOL ID
      let id = "";

      if (path.startsWith("/api/tools/")) {
        try {
          id = decodeURIComponent(
            path.slice("/api/tools/".length)
          ).trim();
        } catch {
          return errorResponse(
            "Invalid Tool ID.",
            400
          );
        }
      }

      if (!id || id.includes("/")) {
        return errorResponse(
          "Tool ID غلط ہے۔",
          400
        );
      }

      // GET TOOL
      if (request.method === "GET") {
        try {
          const value =
            await env.TOOLS_KV.get(
              "tool:" + id
            );

          if (!value) {
            return errorResponse(
              "Tool نہیں ملا۔",
              404
            );
          }

          const tool =
            JSON.parse(value);

          const publicUrl =
            url.origin +
            "/tool/" +
            encodeURIComponent(id);

          return json({
            ok: true,
            id,
            tool,
            url: publicUrl,
            publicUrl
          });

        } catch (error) {
          return errorResponse(
            "Tool fetch failed",
            500,
            error.message || error
          );
        }
      }

      // UPDATE TOOL
      if (request.method === "PUT") {
        try {
          const value =
            await env.TOOLS_KV.get(
              "tool:" + id
            );

          if (!value) {
            return errorResponse(
              "Tool نہیں ملا۔",
              404
            );
          }

          const old =
            JSON.parse(value);

          const body =
            await readBody();

          const html =
            cleanHTML(
              body.html ??
              old.html
            );

          if (
            !/<html[\s>]/i.test(html) ||
            !/<\/html\s*>/i.test(html)
          ) {
            return errorResponse(
              "Updated HTML درست نہیں۔",
              400
            );
          }

          const updated = {
            ...old,

            name: String(
              body.name ??
              old.name
            ).slice(0, 150),

            description: String(
              body.description ??
              old.description
            ).slice(0, 1000),

            html,

            updatedAt:
              new Date().toISOString()
          };

          await env.TOOLS_KV.put(
            "tool:" + id,
            JSON.stringify(updated)
          );

          const publicUrl =
            url.origin +
            "/tool/" +
            encodeURIComponent(id);

          return json({
            ok: true,
            id,
            tool: updated,
            url: publicUrl,
            publicUrl
          });

        } catch (error) {
          return errorResponse(
            "Tool update failed",
            500,
            error.message || error
          );
        }
      }

      return errorResponse(
        "Method not allowed",
        405
      );
    }

    // =========================
    // PUBLIC TOOL
    // =========================

    if (
      path.startsWith("/tool/") &&
      request.method === "GET"
    ) {
      try {

        if (!env.TOOLS_KV) {
          return htmlResponse(
            "Error: TOOLS_KV binding missing.",
            500
          );
        }

        let id;

        try {
          id = decodeURIComponent(
            path.slice("/tool/".length)
          );
        } catch {
          return htmlResponse(
            "Invalid Tool ID",
            400
          );
        }

        if (!id || id.includes("/")) {
          return htmlResponse(
            "Invalid Tool ID",
            400
          );
        }

        const value =
          await env.TOOLS_KV.get(
            "tool:" + id
          );

        if (!value) {
          return htmlResponse(
            "Tool نہیں ملا۔",
            404
          );
        }

        const tool =
          JSON.parse(value);

        return htmlResponse(
          tool.html
        );

      } catch (error) {
        return htmlResponse(
          "Tool Error: " +
          (error.message || error),
          500
        );
      }
    }

    return errorResponse(
      "Route not found",
      404,
      path
    );
  }
};