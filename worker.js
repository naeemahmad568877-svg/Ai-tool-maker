const MODEL = "@cf/google/gemma-4-26b-a4b-it";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
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

    const html = (content, status = 200) =>
      new Response(content, {
        status,
        headers: {
          ...cors,
          "Content-Type": "text/html; charset=utf-8"
        }
      });

    const error = (message, status = 500, detail = "") =>
      json({
        ok: false,
        error: message,
        detail: String(detail || "").slice(0, 3000)
      }, status);

    // OPTIONS / CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    // =========================
    // HEALTH CHECK
    // =========================
    if (path === "/" && request.method === "GET") {
      return json({
        ok: true,
        message: "AI Tool Maker Pro 10 Backend Running",
        version: "4.0",
        ai: !!env.AI,
        toolsKV: !!env.TOOLS_KV,
        model: MODEL,
        routes: [
          "/",
          "/api/chat",
          "/api/tools",
          "/tool/TOOL_ID"
        ]
      });
    }

    // =========================
    // READ JSON
    // =========================
    async function readJSON() {
      try {
        return await request.json();
      } catch {
        throw new Error("درست JSON request موصول نہیں ہوئی۔");
      }
    }

    // =========================
    // EXTRACT AI TEXT
    // =========================
    function getAIText(result) {
      if (typeof result === "string") {
        return result;
      }

      if (typeof result?.response === "string") {
        return result.response;
      }

      if (typeof result?.output_text === "string") {
        return result.output_text;
      }

      if (typeof result?.result?.response === "string") {
        return result.result.response;
      }

      if (typeof result?.choices?.[0]?.message?.content === "string") {
        return result.choices[0].message.content;
      }

      if (Array.isArray(result?.content)) {
        return result.content
          .map(x => x?.text || "")
          .join("\n");
      }

      return "";
    }

    // =========================
    // CLEAN HTML
    // =========================
    function cleanHTML(value) {
      let s = String(value || "").trim();

      if (!s) return "";

      s = s
        .replace(/^```html\s*/i, "")
        .replace(/^```HTML\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const doctype = s.search(/<!doctype\s+html>/i);
      const htmlStart = s.search(/<html[\s>]/i);
      const htmlEnd = s.search(/<\/html\s*>/i);

      if (doctype >= 0) {
        s = s.slice(doctype);
      } else if (htmlStart >= 0) {
        s = s.slice(htmlStart);
      }

      const end = s.search(/<\/html\s*>/i);

      if (end >= 0) {
        const closing = s.match(/<\/html\s*>/i)[0];
        s = s.slice(0, end + closing.length);
      }

      s = s
        .replace(/^```[a-zA-Z]*\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      if (!/^<!doctype\s+html>/i.test(s)) {
        if (/^<html[\s>]/i.test(s)) {
          s = "<!DOCTYPE html>\n" + s;
        }
      }

      return s;
    }

    // =========================
    // AI CHAT
    // =========================
    if (path === "/api/chat" && request.method === "POST") {
      try {
        if (!env.AI) {
          return error(
            "Cloudflare AI binding missing. Worker میں AI binding attach کریں۔",
            500
          );
        }

        const body = await readJSON();

        const prompt = String(
          body.prompt ||
          body.message ||
          ""
        ).trim();

        const language = String(
          body.language || "Urdu"
        );

        if (!prompt) {
          return error(
            "Prompt خالی ہے۔",
            400
          );
        }

        if (prompt.length > 30000) {
          return error(
            "Prompt بہت لمبا ہے۔",
            413
          );
        }

        const systemPrompt = `
You are AI Tool Maker Pro 10 International.

Your job is to create complete working browser-based web applications.

IMPORTANT RULES:

1. Return ONLY complete HTML.
2. Start with <!DOCTYPE html>.
3. Include HTML, CSS and JavaScript in ONE document.
4. Include both <html> and </html>.
5. Do NOT use markdown code fences.
6. Do NOT write explanations outside the HTML.
7. Make the application responsive and mobile friendly.
8. Make buttons functional.
9. Preserve all requested features.
10. Do not invent fake external API integrations.
11. If an external service is required but not configured, clearly handle that inside the generated application.
12. Use language: ${language}.
13. Return the FULL HTML DOCUMENT.
14. Never return a partial code snippet.
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

        const raw = getAIText(result);
        const output = cleanHTML(raw);

        if (!output) {
          return error(
            "Cloudflare AI نے کوئی HTML جواب نہیں دیا۔",
            502,
            JSON.stringify(result)
          );
        }

        if (
          !/<html[\s>]/i.test(output) ||
          !/<\/html\s*>/i.test(output)
        ) {
          return error(
            "AI نے مکمل HTML document نہیں دیا۔",
            502,
            output.slice(0, 3000)
          );
        }

        return json({
          ok: true,
          output,
          response: output,
          text: output,
          html: output
        });

      } catch (e) {
        return error(
          "AI request failed",
          500,
          e?.message || String(e)
        );
      }
    }

    // =========================
    // TOOLS API
    // =========================
    if (
      path === "/api/tools" ||
      path.startsWith("/api/tools/")
    ) {

      if (!env.TOOLS_KV) {
        return error(
          "TOOLS_KV binding missing. Cloudflare Worker میں KV binding attach کریں۔",
          500
        );
      }

      // CREATE
      if (
        path === "/api/tools" &&
        request.method === "POST"
      ) {
        try {
          const body = await readJSON();

          const toolHTML = cleanHTML(
            body.html ||
            body.output ||
            body.response ||
            ""
          );

          if (
            !/<html[\s>]/i.test(toolHTML) ||
            !/<\/html\s*>/i.test(toolHTML)
          ) {
            return error(
              "درست مکمل HTML Tool موصول نہیں ہوا۔",
              400
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

            html: toolHTML,

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

        } catch (e) {
          return error(
            "Tool save failed",
            500,
            e?.message || String(e)
          );
        }
      }

      // GET / UPDATE TOOL ID
      let id = "";

      if (path.startsWith("/api/tools/")) {
        try {
          id = decodeURIComponent(
            path.slice("/api/tools/".length)
          ).trim();
        } catch {
          return error(
            "Invalid Tool ID",
            400
          );
        }
      }

      if (!id || id.includes("/")) {
        return error(
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
            return error(
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

        } catch (e) {
          return error(
            "Tool fetch failed",
            500,
            e?.message || String(e)
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
            return error(
              "Tool نہیں ملا۔",
              404
            );
          }

          const old =
            JSON.parse(value);

          const body =
            await readJSON();

          const updatedHTML =
            cleanHTML(
              body.html ?? old.html
            );

          if (
            !/<html[\s>]/i.test(updatedHTML) ||
            !/<\/html\s*>/i.test(updatedHTML)
          ) {
            return error(
              "Updated HTML درست نہیں ہے۔",
              400
            );
          }

          const updated = {
            ...old,

            name: String(
              body.name ??
              old.name ??
              "AI Tool"
            ).slice(0, 150),

            description: String(
              body.description ??
              old.description ??
              ""
            ).slice(0, 1000),

            html: updatedHTML,

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

        } catch (e) {
          return error(
            "Tool update failed",
            500,
            e?.message || String(e)
          );
        }
      }

      return error(
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
          return html(
            "Error: TOOLS_KV binding missing.",
            500
          );
        }

        let id;

        try {
          id = decodeURIComponent(
            path.slice("/tool/".length)
          ).trim();
        } catch {
          return html(
            "Invalid Tool ID",
            400
          );
        }

        if (!id || id.includes("/")) {
          return html(
            "Invalid Tool ID",
            400
          );
        }

        const value =
          await env.TOOLS_KV.get(
            "tool:" + id
          );

        if (!value) {
          return html(
            "Tool نہیں ملا۔",
            404
          );
        }

        const tool =
          JSON.parse(value);

        return html(
          tool.html
        );

      } catch (e) {
        return html(
          "Tool Error: " +
          (e?.message || String(e)),
          500
        );
      }
    }

    return error(
      "Route not found",
      404,
      path
    );
  }
};