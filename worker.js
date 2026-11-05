
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
        name: "AI Tool Maker Pro 9",
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

        const htmlTasks = [
          "build_html",
          "generate_complete_html",
          "smart_builder"
        ];

        let taskInstructions = `
You are the real AI engine of AI Tool Maker Pro 9.

You must:
- Answer user questions helpfully.
- Understand the user's actual request.
- Create useful tools and applications.
- Generate functional code when requested.
- Write responsive HTML, CSS and JavaScript.
- Never pretend that an action was completed if it was not.
- Explain errors clearly.
- Respond in the requested language.
`;

        if (htmlTasks.includes(task)) {
          taskInstructions += `
IMPORTANT HTML GENERATION RULES:
- Generate a complete single-file HTML document.
- Include HTML, CSS and JavaScript.
- Include working buttons and functional features.
- Make the design responsive for mobile and desktop.
- Do not use placeholder functionality.
- Do not return Markdown code fences.
- Return only the complete HTML code.
`;
        } else if (task === "connection_test") {
          taskInstructions += `
This is a backend connection test.
Reply exactly:
AI BACKEND OK
`;
        } else if (task === "video_creator") {
          taskInstructions += `
This is a video creation request.
Explain what video-related assistance you can provide.
You may generate video scripts, storyboards, scene plans and prompts.
Do not claim to render or export a real video unless an actual video generation service is connected.
`;
        } else {
          taskInstructions += `
Answer naturally and directly.
Provide useful explanations, ideas and code when requested.
`;
        }

        const systemPrompt = `
${taskInstructions}

Language: ${language}
Task: ${task}
Tool type: ${toolType}

You are operating inside AI Tool Maker Pro 9.
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
          result?.output ||
          result?.result;

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
          model: "@cf/google/gemma-4-26b-a4b-it",
          task: task
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
