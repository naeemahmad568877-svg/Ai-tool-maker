export default {
  async fetch(request, env) {

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    const url = new URL(request.url);

    if (url.pathname !== "/api/chat") {
      return new Response(
        JSON.stringify({
          error: "API route not found"
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...cors
          }
        }
      );
    }

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          error: "POST method required"
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            ...cors
          }
        }
      );
    }

    try {

      const body = await request.json();

      const prompt =
        String(body.prompt || "").trim();

      if (!prompt) {
        return new Response(
          JSON.stringify({
            error: "Prompt is empty"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...cors
            }
          }
        );
      }

      const aiResult = await env.AI.run(
        "@cf/google/gemma-4-26b-a4b-it",
        {
          messages: [
            {
              role: "system",
              content:
                "You are AI Tool Maker Pro 10. Follow the user's instructions and generate useful working web tools. When asked to build a tool, return complete HTML."
            },
            {
              role: "user",
              content: prompt
            }
          ]
        }
      );

      const output =
        aiResult?.response ||
        aiResult?.choices?.[0]?.message?.content ||
        "";

      if (!output || !String(output).trim()) {

        return new Response(
          JSON.stringify({
            error: "Cloudflare AI returned an empty response",
            debug: aiResult
          }),
          {
            status: 502,
            headers: {
              "Content-Type": "application/json",
              ...cors
            }
          }
        );
      }

      return new Response(
        JSON.stringify({
          output: String(output)
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...cors
          }
        }
      );

    } catch (error) {

      return new Response(
        JSON.stringify({
          error:
            error?.message ||
            "Worker AI request failed"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...cors
          }
        }
      );
    }
  }
};