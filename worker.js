export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "POST request required." },
          { status: 405 }
        );
      }

      try {
        if (!env.AI) {
          throw new Error("Cloudflare AI binding is missing.");
        }

        const body = await request.json();
        const prompt = String(body.prompt || "").trim();

        if (!prompt) {
          return Response.json(
            { error: "Please enter your prompt." },
            { status: 400 }
          );
        }

        if (prompt.length > 12000) {
          return Response.json(
            { error: "Prompt is too long." },
            { status: 400 }
          );
        }

        const response = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are a helpful AI assistant inside AI Tool Maker. Answer clearly and help users create useful tools. Reply in the same language as the user."
              },
              {
                role: "user",
                content: prompt
              }
            ]
          }
        );

        const answer =
          response.response ||
          response.choices?.[0]?.message?.content;

        if (!answer) {
          throw new Error("AI returned an empty response.");
        }

        return Response.json({ answer });

      } catch (error) {
        return Response.json(
          { error: "AI request failed. Please check your Cloudflare AI setup and try again." },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};