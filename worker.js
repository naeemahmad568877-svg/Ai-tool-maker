
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

    // AI backend health test
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        success: true,
        message: "AI Tool Maker backend is running",
        aiBinding: !!env.AI
      });
    }

    // Real AI endpoints
    if (
      url.pathname === "/api/chat" ||
      url.pathname === "/api/generate"
    ) {
      if (request.method !== "POST") {
        return json({ success: false, error: "POST required" }, 405);
      }

      if (!env.AI) {
        return json({
          success: false,
          error: "Cloudflare AI binding AI is missing"
        }, 500);
      }

      try {
        const body = await request.json();

        const prompt = String(body.prompt || "").trim();
        const language = String(body.language || "English");
        const task = String(body.task || "chat");
        const toolType = String(body.toolType || "general");

        if (!prompt) {
          return json({
            success: false,
            error: "Please enter a prompt"
          }, 400);
        }

        if (prompt.length > 12000) {
          return json({
            success: false,
            error: "Prompt is too long"
          }, 400);
        }

        const systemPrompt =
          task === "generate"
            ? `You are an expert AI software developer inside AI Tool Maker.
Create a complete, working, self-contained HTML application.
Tool type: ${toolType}.
Language: ${language}.
Return the complete HTML document starting with <!DOCTYPE html>.
Include CSS and JavaScript inside the HTML.
Do not use markdown code fences.
Do not give explanations instead of code.
Make the application responsive and functional.`
            : `You are the real AI assistant inside AI Tool Maker.
Answer the user's request helpfully and accurately.
Use language: ${language}.
Do not pretend to be a local template generator.
Follow the user's instructions.`;

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
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        );

        let output =
          result?.response ||
          result?.output ||
          result?.answer ||
          result?.choices?.[0]?.message?.content ||
          "";

        if (typeof output !== "string") {
          output = JSON.stringify(output);
        }

        output = output.trim();

        if (!output) {
          return json({
            success: false,
            error: "AI returned an empty response",
            raw: result
          }, 502);
        }

        return json({
          success: true,
          output: output,
          answer: output,
          response: output
        });

      } catch (error) {
        return json({
          success: false,
          error: error.message || "AI request failed"
        }, 500);
      }
    }

    // Serve the website
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({
      success: false,
      error: "Website assets binding ASSETS is missing"
    }, 500);
  }
};
