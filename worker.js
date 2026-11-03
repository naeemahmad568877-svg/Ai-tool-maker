
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    function json(data, status = 200) {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=UTF-8"
        }
      });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    // Backend health check
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        success: true,
        status: "online",
        name: "AI Tool Maker Pro 7",
        ai: !!env.AI,
        model: "@cf/google/gemma-4-26b-a4b-it"
      });
    }

    // AI API routes
    if (
      url.pathname === "/api/chat" ||
      url.pathname === "/api/generate"
    ) {
      if (request.method !== "POST") {
        return json({
          success: false,
          error: "POST request required."
        }, 405);
      }

      try {
        if (!env.AI) {
          return json({
            success: false,
            error: "Cloudflare AI binding missing."
          }, 500);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            success: false,
            error: "Invalid JSON request."
          }, 400);
        }

        const prompt = String(body.prompt || "").trim();
        const language = String(body.language || "اردو");
        const task = String(body.task || "chat");
        const toolType = String(body.toolType || "general");

        if (!prompt) {
          return json({
            success: false,
            error: "Please enter your prompt."
          }, 400);
        }

        if (prompt.length > 12000) {
          return json({
            success: false,
            error: "Prompt is too long."
          }, 400);
        }

        const systemPrompt = `
You are the real AI engine of AI Tool Maker Pro 7.

Your tasks:
- Answer user questions.
- Create useful tools and applications.
- Generate complete HTML, CSS and JavaScript.
- Help users build responsive web applications.
- Write functional code, not fake demonstrations.

Language: ${language}
Task: ${task}
Tool type: ${toolType}

For build_html tasks:
Return complete single-file HTML.
Include working buttons, CSS and JavaScript.
Do not return explanations or Markdown fences.
`;

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
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
            max_tokens: 4096
          }
        );

        const output =
          result?.response ||
          result?.choices?.[0]?.message?.content ||
          result?.output;

        if (!output) {
          return json({
            success: false,
            error: "AI returned an empty response."
          }, 500);
        }

        return json({
          success: true,
          output: output,
          answer: output,
          model: "@cf/google/gemma-4-26b-a4b-it"
        });

      } catch (error) {
        console.error("AI Backend Error:", error);

        return json({
          success: false,
          error: error.message || "AI request failed."
        }, 500);
      }
    }

    // Serve website assets
    if (env.ASSETS) {
      const response = await env.ASSETS.fetch(request);

      const newHeaders = new Headers(response.headers);

      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }

    return json({
      success: true,
      status: "Worker is running."
    });
  }
};
