
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function extractText(result) {
  const candidates = [
    result?.response,
    result?.output,
    result?.answer,
    result?.choices?.[0]?.message?.content,
    result?.result?.response,
    result?.result?.output
  ];

  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }

    if (Array.isArray(item)) {
      const text = item
        .map(part => typeof part === "string"
          ? part
          : part?.text || "")
        .join("");

      if (text.trim()) return text.trim();
    }

    if (item && typeof item === "object" && item.text) {
      return String(item.text).trim();
    }
  }

  if (typeof result === "string") {
    return result.trim();
  }

  return "";
}

function cleanHTML(value) {
  let html = String(value || "").trim();

  html = html.replace(/^```(?:html)?\s*/i, "");
  html = html.replace(/\s*```$/i, "");

  const start = html.search(/<!doctype\s+html/i);

  if (start >= 0) {
    html = html.slice(start);
  }

  const end = html.toLowerCase().lastIndexOf("</html>");

  if (end >= 0) {
    html = html.slice(0, end + 7);
  }

  return html.trim();
}

async function callAI(env, messages) {
  const result = await env.AI.run(MODEL, {
    messages,
    chat_template_kwargs: {
      enable_thinking: false
    }
  });

  const output = extractText(result);

  if (!output) {
    throw new Error(
      "AI returned an empty response. Check the AI model and Cloudflare logs."
    );
  }

  return output;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // =====================================
    // 1. CORS
    // =====================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {

      // =====================================
      // 2. HEALTH CHECK
      // =====================================

      if (path === "/api/health" && request.method === "GET") {
        return json({
          success: true,
          name: "AI Tool Maker Pro 9",
          aiBinding: !!env.AI,
          storageBinding: !!env.TOOLS_BUCKET,
          model: MODEL,
          features: [
            "Real Cloudflare AI",
            "AI Chat",
            "Automatic HTML Generation",
            "Automatic Tool Updates",
            "Permanent Tool Links",
            "R2 Storage",
            "Version History"
          ]
        });
      }

      // =====================================
      // 3. CHECK AI BINDING
      // =====================================

      if (
        (path === "/api/chat" || path === "/api/create") &&
        request.method === "POST" &&
        !env.AI
      ) {
        return json({
          success: false,
          error: "Cloudflare AI binding AI is missing."
        }, 500);
      }

      // =====================================
      // 4. REAL AI CHAT
      // =====================================

      if (path === "/api/chat" && request.method === "POST") {

        const body = await request.json();
        const prompt = String(body.prompt || "").trim();

        if (!prompt) {
          return json({
            success: false,
            error: "Please enter a prompt."
          }, 400);
        }

        if (prompt.length > 12000) {
          return json({
            success: false,
            error: "Prompt is too long."
          }, 400);
        }

        const output = await callAI(env, [
          {
            role: "system",
            content:
              "You are a helpful real AI assistant inside AI Tool Maker Pro 9. Answer clearly and accurately in the user's language. If the user requests a web application, explain that they can use the AI Builder to generate its HTML."
          },
          {
            role: "user",
            content: prompt
          }
        ]);

        return json({
          success: true,
          output,
          answer: output,
          response: output
        });
      }

      // =====================================
      // 5. CREATE OR UPDATE AI TOOL
      // =====================================

      if (path === "/api/create" && request.method === "POST") {

        if (!env.TOOLS_BUCKET) {
          return json({
            success: false,
            error: "R2 storage is not connected. Please add the TOOLS_BUCKET binding in Cloudflare."
          }, 503);
        }

        const body = await request.json();

        const prompt = String(body.prompt || "").trim();

        const toolName = String(
          body.toolName || body.name || "My AI Tool"
        ).trim();

        const language = String(
          body.language || "Urdu"
        );

        let id = String(body.toolId || "").trim();

        if (!prompt) {
          return json({
            success: false,
            error: "Please enter your tool instructions."
          }, 400);
        }

        if (prompt.length > 12000) {
          return json({
            success: false,
            error: "Prompt exceeds 12000 characters."
          }, 400);
        }

        if (id && !/^[a-f0-9-]{36}$/i.test(id)) {
          return json({
            success: false,
            error: "Invalid tool ID."
          }, 400);
        }

        // Load existing application

        let previousHTML = "";
        let currentVersion = 0;
        let isUpdate = false;

        if (id) {

          const existing = await env.TOOLS_BUCKET.get(
            id + ".html"
          );

          if (!existing) {
            return json({
              success: false,
              error: "Existing tool was not found."
            }, 404);
          }

          previousHTML = await existing.text();

          currentVersion = Number(
            existing.customMetadata?.version || 1
          );

          isUpdate = true;

          if (previousHTML.length > 150000) {
            return json({
              success: false,
              error: "Existing HTML is too large to update."
            }, 413);
          }

        } else {
          id = crypto.randomUUID();
        }

        // AI developer instructions

        const systemPrompt = `
You are AI Tool Maker Pro 9.

You are an expert full-stack web application developer.

Your task is to create complete, professional and functional web applications.

STRICT OUTPUT RULES:

1. Return ONLY complete HTML.
2. Start with <!DOCTYPE html>.
3. End with </html>.
4. Include HTML, CSS and JavaScript in one file.
5. Make the application mobile responsive.
6. Make all buttons functional.
7. Use a professional modern interface.
8. Do not return Markdown.
9. Do not use code fences.
10. Do not return explanations outside HTML.
11. Do not create a calculator unless requested.
12. Never invent external API connections.
13. Clearly explain external API requirements.
14. Preserve existing functionality when updating.
15. Follow the requested language.
16. Return the entire HTML document.
17. Use safe and functional JavaScript.
18. Do not return a design mockup.
19. Build a genuinely usable application.

You are building applications for AI Tool Maker Pro 9.
`;

        let userPrompt;

        if (isUpdate) {

          userPrompt = `
UPDATE THE EXISTING APPLICATION.

Application name: ${toolName}

Current version: ${currentVersion}

User's new instructions:
${prompt}

Existing complete HTML:

${previousHTML}

Preserve existing functionality.
Implement the requested changes.
Return the complete updated HTML document.

Start with <!DOCTYPE html>
End with </html>.
`;

        } else {

          userPrompt = `
CREATE A BRAND NEW WEB APPLICATION.

Application name:
${toolName}

User's idea:
${prompt}

Interface language:
${language}

Build a complete professional application.

Include all requested features.
Make every requested button functional.
Use responsive HTML, CSS and JavaScript.

Return the entire HTML document.
`;
        }

        // =====================================
        // 6. CALL REAL CLOUDFLARE AI
        // =====================================

        const aiOutput = await callAI(env, [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]);

        // =====================================
        // 7. CLEAN GENERATED HTML
        // =====================================

        const html = cleanHTML(aiOutput);

        if (
          !/<!doctype\s+html/i.test(html) ||
          !/<html[\s>]/i.test(html) ||
          !/<\/html>/i.test(html)
        ) {
          return json({
            success: false,
            error: "AI did not return complete HTML.",
            details: aiOutput.slice(0, 1500)
          }, 502);
        }

        if (html.length > 2 * 1024 * 1024) {
          return json({
            success: false,
            error: "Generated HTML exceeds 2MB."
          }, 413);
        }

        // =====================================
        // 8. SAVE PREVIOUS VERSION
        // =====================================

        if (isUpdate) {

          const archiveKey =
            id +
            "/versions/v" +
            currentVersion +
            "-" +
            Date.now() +
            ".html";

          await env.TOOLS_BUCKET.put(
            archiveKey,
            previousHTML,
            {
              httpMetadata: {
                contentType: "text/html; charset=utf-8"
              },
              customMetadata: {
                toolId: id,
                version: String(currentVersion)
              }
            }
          );
        }

        // =====================================
        // 9. SAVE NEW HTML TO R2
        // =====================================

        const nextVersion = currentVersion + 1;

        await env.TOOLS_BUCKET.put(
          id + ".html",
          html,
          {
            httpMetadata: {
              contentType: "text/html; charset=utf-8"
            },
            customMetadata: {
              toolId: id,
              name: toolName,
              version: String(nextVersion),
              updatedAt: new Date().toISOString()
            }
          }
        );

        // =====================================
        // 10. PERMANENT TOOL LINK
        // =====================================

        const publicUrl =
          url.origin + "/tools/" + id;

        // =====================================
        // 11. SUCCESS
        // =====================================

        return json({
          success: true,
          message: isUpdate
            ? "AI tool updated successfully."
            : "AI tool created successfully.",

          id,
          toolId: id,
          toolName,
          publicUrl,
          html,
          version: nextVersion,
          updated: isUpdate,
          previousVersionSaved: isUpdate,
          size: html.length
        });
      }

      // =====================================
      // 12. LOAD SAVED PUBLIC TOOL
      // =====================================

      if (
        request.method === "GET" &&
        path.startsWith("/tools/")
      ) {

        const id = path.split("/")[2];

        if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
          return new Response("Invalid tool link", {
            status: 400,
            headers: corsHeaders
          });
        }

        if (!env.TOOLS_BUCKET) {
          return new Response(
            "R2 storage is not configured.",
            { status: 503, headers: corsHeaders }
          );
        }

        const file = await env.TOOLS_BUCKET.get(
          id + ".html"
        );

        if (!file) {
          return new Response("Tool not found", {
            status: 404,
            headers: corsHeaders
          });
        }

        return new Response(file.body, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      // =====================================
      // 13. VERSION HISTORY
      // =====================================

      if (
        path.startsWith("/api/versions/") &&
        request.method === "GET"
      ) {

        if (!env.TOOLS_BUCKET) {
          return json({
            success: false,
            error: "R2 storage is not connected."
          }, 503);
        }

        const id = path.split("/")[3];

        if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
          return json({
            success: false,
            error: "Invalid tool ID."
          }, 400);
        }

        const result = await env.TOOLS_BUCKET.list({
          prefix: id + "/versions/",
          limit: 100
        });

        return json({
          success: true,
          toolId: id,
          versions: result.objects.map(item => ({
            key: item.key,
            size: item.size,
            uploaded: item.uploaded
          }))
        });
      }

      // =====================================
      // 14. SERVE WEBSITE ASSETS
      // =====================================

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return json({
        success: false,
        error: "API route not found."
      }, 404);

    } catch (error) {

      return json({
        success: false,
        error: error.message || "Internal server error"
      }, 500);

    }
  }
};
