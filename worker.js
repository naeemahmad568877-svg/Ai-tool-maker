export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // =========================
    // AI CHAT
    // =========================
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        if (!env.AI) {
          return new Response(
            JSON.stringify({ error: "Cloudflare AI binding 'AI' موجود نہیں۔" }),
            { status: 500, headers: cors }
          );
        }

        const body = await request.json();
        const prompt = String(body.prompt || "").trim();

        if (!prompt) {
          return new Response(
            JSON.stringify({ error: "Prompt خالی ہے۔" }),
            { status: 400, headers: cors }
          );
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "user",
                content: prompt
              }
            ]
          }
        );

        let output = "";

        if (typeof result === "string") {
          output = result;
        } else if (result?.response) {
          output = result.response;
        } else if (result?.result?.response) {
          output = result.result.response;
        } else {
          output = JSON.stringify(result);
        }

        return new Response(
          JSON.stringify({ output }),
          { status: 200, headers: cors }
        );

      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "AI request failed",
            detail: error?.message || String(error)
          }),
          { status: 500, headers: cors }
        );
      }
    }

    // =========================
    // CREATE PUBLIC TOOL
    // =========================
    if (url.pathname === "/api/tools" && request.method === "POST") {
      try {
        if (!env.TOOLS_KV) {
          return new Response(
            JSON.stringify({
              error: "TOOLS_KV binding موجود نہیں۔"
            }),
            { status: 500, headers: cors }
          );
        }

        const body = await request.json();

        const html = String(body.html || "").trim();
        const name = String(body.name || "AI Tool").trim();
        const description = String(body.description || "").trim();

        if (!html) {
          return new Response(
            JSON.stringify({ error: "Tool HTML خالی ہے۔" }),
            { status: 400, headers: cors }
          );
        }

        const id =
          "tool_" +
          Date.now().toString(36) +
          "_" +
          crypto.randomUUID().slice(0, 8);

        const tool = {
          id,
          name,
          description,
          html,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await env.TOOLS_KV.put(
          `tool:${id}`,
          JSON.stringify(tool)
        );

        return new Response(
          JSON.stringify({
            ok: true,
            id,
            tool
          }),
          { status: 201, headers: cors }
        );

      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "Tool save failed",
            detail: error?.message || String(error)
          }),
          { status: 500, headers: cors }
        );
      }
    }

    // =========================
    // GET PUBLIC TOOL
    // =========================
    if (
      url.pathname.startsWith("/api/tools/") &&
      request.method === "GET"
    ) {
      try {
        if (!env.TOOLS_KV) {
          return new Response(
            JSON.stringify({
              error: "TOOLS_KV binding موجود نہیں۔"
            }),
            { status: 500, headers: cors }
          );
        }

        const id = url.pathname.split("/").pop();

        if (!id) {
          return new Response(
            JSON.stringify({ error: "Tool ID missing" }),
            { status: 400, headers: cors }
          );
        }

        const value = await env.TOOLS_KV.get(`tool:${id}`);

        if (!value) {
          return new Response(
            JSON.stringify({
              error: "Tool نہیں ملا۔"
            }),
            { status: 404, headers: cors }
          );
        }

        return new Response(value, {
          status: 200,
          headers: cors
        });

      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "Tool fetch failed",
            detail: error?.message || String(error)
          }),
          { status: 500, headers: cors }
        );
      }
    }

    // =========================
    // UPDATE PUBLIC TOOL
    // =========================
    if (
      url.pathname.startsWith("/api/tools/") &&
      request.method === "PUT"
    ) {
      try {
        if (!env.TOOLS_KV) {
          return new Response(
            JSON.stringify({
              error: "TOOLS_KV binding موجود نہیں۔"
            }),
            { status: 500, headers: cors }
          );
        }

        const id = url.pathname.split("/").pop();

        const oldValue = await env.TOOLS_KV.get(`tool:${id}`);

        if (!oldValue) {
          return new Response(
            JSON.stringify({
              error: "Tool نہیں ملا۔"
            }),
            { status: 404, headers: cors }
          );
        }

        const oldTool = JSON.parse(oldValue);
        const body = await request.json();

        const updatedTool = {
          ...oldTool,
          name: String(body.name || oldTool.name),
          description: String(
            body.description ?? oldTool.description
          ),
          html: String(body.html || oldTool.html),
          updatedAt: new Date().toISOString()
        };

        await env.TOOLS_KV.put(
          `tool:${id}`,
          JSON.stringify(updatedTool)
        );

        return new Response(
          JSON.stringify({
            ok: true,
            tool: updatedTool
          }),
          { status: 200, headers: cors }
        );

      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "Tool update failed",
            detail: error?.message || String(error)
          }),
          { status: 500, headers: cors }
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "AI Tool Maker Backend is running"
      }),
      { status: 200, headers: cors }
    );
  }
};