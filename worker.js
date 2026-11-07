export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);

    // AI API
    if (url.pathname === "/api/chat") {

      if (request.method !== "POST") {
        return new Response(
          JSON.stringify({
            error: "POST required"
          }),
          {
            status: 405,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }

      try {

        const body = await request.json();

        const prompt =
          typeof body.prompt === "string"
            ? body.prompt
            : "";

        if (!prompt.trim()) {
          return new Response(
            JSON.stringify({
              error: "Prompt is required"
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders
              }
            }
          );
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "system",
                content:
                  "You are an expert AI web tool builder. Generate complete working HTML tools when requested."
              },
              {
                role: "user",
                content: prompt
              }
            ]
          }
        );

        return new Response(
          JSON.stringify({
            output:
              result.response ||
              result.text ||
              ""
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );

      } catch (error) {

        return new Response(
          JSON.stringify({
            error: error.message || "AI request failed"
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders
            }
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: "Not found"
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      }
    );
  }
};