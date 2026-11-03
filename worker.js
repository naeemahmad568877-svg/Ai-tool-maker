
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    if (
      url.pathname === "/api/generate" ||
      url.pathname === "/api/chat"
    ) {
      if (request.method !== "POST") {
        return Response.json(
          { error: "POST request required." },
          { status: 405, headers }
        );
      }

      try {
        if (!env.AI) {
          throw new Error("AI binding is missing. Add AI binding in Cloudflare.");
        }

        const body = await request.json();
        const prompt = String(body.prompt || "").trim();
        const language = String(body.language || "Auto");

        if (!prompt) {
          return Response.json(
            { error: "Please enter your prompt." },
            { status: 400, headers }
          );
        }

        if (prompt.length > 12000) {
          return Response.json(
            { error: "Prompt is too long." },
            { status: 400, headers }
          );
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are the AI engine of AI Tool Maker. Help users create tools, applications, HTML, CSS, JavaScript and useful projects. Follow the requested language: " +
                  language +
                  ". Give complete and useful answers."
              },
              {
                role: "user",
                content: prompt
              }
            ]
          }
        );

        const output =
          result.response ||
          result.choices?.[0]?.message?.content ||
          result.output;

        if (!output) {
          throw new Error("AI returned an empty response.");
        }

        return Response.json(
          { output, answer: output },
          { headers }
        );

      } catch (error) {
        console.error("AI Backend Error:", error);

        return Response.json(
          { error: error.message || "AI request failed." },
          { status: 500, headers }
        );
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("AI Tool Maker Worker is running.", {
      headers
    });
  }
};
