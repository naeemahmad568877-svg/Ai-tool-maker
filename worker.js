
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

        let systemPrompt = `
You are the real AI engine of AI Tool Maker Pro 9.

Your job:
- Understand the user's actual request.
- Answer questions helpfully.
- Create useful tools and applications.
- Generate functional HTML, CSS and JavaScript.
- Build responsive mobile-friendly web applications.
- Write real working code, not fake demonstrations.
- Follow the user's requested language.

Language: ${language}
Task: ${task}
Tool type: ${toolType}
`;

        if (htmlTasks.includes(task)) {
          systemPrompt += `
HTML GENERATION REQUIREMENTS:

- Return a complete single-file HTML document.
- Start the response with <!DOCTYPE html>.
- Include all CSS inside a style tag.
- Include all JavaScript inside a script tag.
- Include working buttons and functional features.
- Make the design responsive for mobile and desktop.
- Do not return explanations.
- Do not use Markdown code fences.
- Do not return an incomplete HTML fragment.
- Return only the HTML document.
`;
        } else if (task === "connection_test") {
          systemPrompt += `
This is a backend connection test.
Reply exactly:
AI BACKEND OK
`;
        } else if (task === "video_creator") {
          systemPrompt += `
This is a video creator application request.
You can create video scripts, storyboards, scene plans,
HTML video editing interfaces and browser-based slideshow tools.
Do not claim to generate a real AI video unless a video
generation model or service is actually connected.
`;
        } else {
          systemPrompt += `
Answer naturally and directly.
Provide useful explanations, ideas and code when requested.
`;
        }

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

            // Disable thinking mode for direct answers and code.
            chat_template_kwargs: {
              enable_thinking: false
            },

            max_tokens: 4096
          }
        );

        // Read AI response in supported response formats.
        const output =
          result?.response ||
          result?.choices?.[0]?.message?.content ||
          result?.choices?.[0]?.text ||
          result?.output ||
          result?.result ||
          "";

        if (!output || !String(output).trim()) {
          return json({
            success: false,
            error: "AI returned an empty response.",
            details: "Please try again."
          }, 500);
        }

        return json({
          success: true,
          output: String(output),
          answer: String(output),
          response: String(output),
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
