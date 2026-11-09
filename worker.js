
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

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // HEALTH CHECK
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        ok: true,
        message: "AI Tool Maker Pro 10 Backend Running",
        ai: !!env.AI,
        toolsKV: !!kv,
        bindingDetectedAs: env.TOOLS_KV
          ? "TOOLS_KV"
          : env.AI_TOOLS ? "AI_TOOLS" : null
      });
    }

    // AI CHAT
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        if (!env.AI) {
          return json({ error: "Workers AI binding AI missing." }, 500);
        }

        const body = await request.json();
        const prompt = String(body.prompt || "").trim();

        if (!prompt) {
          return json({ error: "Prompt خالی ہے۔" }, 400);
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              { role: "user", content: prompt }
            ]
          }
        );

        const output =
          typeof result === "string"
            ? result
            : typeof result?.response === "string"
              ? result.response
              : typeof result?.result?.response === "string"
                ? result.result.response
                : "";

        if (!output.trim()) {
          return json({
            error: "AI نے خالی جواب دیا۔",
            detail: JSON.stringify(result).slice(0, 1000)
          }, 502);
        }

        return json({ ok: true, output });

      } catch (error) {
        return json({
          error: "AI request failed",
          detail: error.message || String(error)
        }, 500);
      }
    }

    // ALL TOOL STORAGE ROUTES
    if (url.pathname === "/api/tools" ||
        url.pathname.startsWith("/api/tools/")) {

      if (!kv) {
        return json({
          error: "KV Binding missing. TOOLS_KV کو AI_TOOLS Namespace سے جوڑیں۔"
        }, 500);
      }

      // CREATE TOOL
      if (url.pathname === "/api/tools" && request.method === "POST") {
        try {
          const body = await request.json();
          const name = String(body.name || "AI Tool").trim();
          const description = String(body.description || "").trim();
          const html = String(body.html || "").trim();

          if (!/<html[\s>]/i.test(html)) {
            return json({ error: "درست HTML Tool موصول نہیں ہوا۔" }, 400);
          }

          const id = "tool_" + crypto.randomUUID();
          const now = new Date().toISOString();

          const tool = {
            id, name, description, html,
            createdAt: now,
            updatedAt: now
          };

          await kv.put("tool:" + id, JSON.stringify(tool));

          const publicUrl = `${url.origin}/tool/${encodeURIComponent(id)}`;

          return json({
            ok: true, id, tool,
            url: publicUrl,
            publicUrl
          }, 201);

        } catch (error) {
          return json({
            error: "Tool save failed",
            detail: error.message || String(error)
          }, 500);
        }
      }

      const id = decodeURIComponent(
        url.pathname.slice("/api/tools/".length)
      ).trim();

      if (!id || id.includes("/")) {
        return json({ error: "Tool ID غلط ہے۔" }, 400);
      }

      // GET TOOL
      if (request.method === "GET") {
        try {
          const value = await kv.get("tool:" + id);

          if (!value) {
            return json({ error: "Tool نہیں ملا۔" }, 404);
          }

          const tool = JSON.parse(value);
          const publicUrl = `${url.origin}/tool/${encodeURIComponent(id)}`;

          return json({ ok: true, id, tool, url: publicUrl, publicUrl });

        } catch (error) {
          return json({
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
            return json({ error: "Tool نہیں ملا۔" }, 404);
          }

          const oldTool = JSON.parse(value);
          const body = await request.json();

          const updatedTool = {
            ...oldTool,
            name: String(body.name ?? oldTool.name),
            description: String(body.description ?? oldTool.description),
            html: String(body.html ?? oldTool.html),
            updatedAt: new Date().toISOString()
          };

          if (!/<html[\s>]/i.test(updatedTool.html)) {
            return json({ error: "Updated HTML درست نہیں۔" }, 400);
          }

          await kv.put("tool:" + id, JSON.stringify(updatedTool));

          const publicUrl = `${url.origin}/tool/${encodeURIComponent(id)}`;

          return json({
            ok: true, id,
            tool: updatedTool,
            url: publicUrl,
            publicUrl
          });

        } catch (error) {
          return json({
            error: "Tool update failed",
            detail: error.message || String(error)
          }, 500);
        }
      }

      return json({ error: "Method not allowed" }, 405);
    }

    // PUBLIC TOOL
    if (url.pathname.startsWith("/tool/") && request.method === "GET") {
      try {
        if (!kv) {
          return new Response("KV Binding missing", { status: 500 });
        }

        const id = decodeURIComponent(
          url.pathname.slice("/tool/".length)
        );

        const value = await kv.get("tool:" + id);

        if (!value) {
          return new Response("Tool نہیں ملا۔", { status: 404 });
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
        return new Response("Tool Error: " + (error.message || String(error)), {
          status: 500
        });
      }
    }

    return json({ error: "Route not found" }, 404);
  }
};
