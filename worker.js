
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
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
      return new Response(null, {
        status: 204,
        headers
      });
    }

    // =====================================
    // 1. BACKEND HEALTH CHECK
    // =====================================

    if (url.pathname === "/api/health") {
      return json({
        success: true,
        name: "AI Tool Maker Pro 9",
        aiBinding: !!env.AI,
        storageBinding: !!env.TOOLS_BUCKET,
        features: [
          "Real AI Builder",
          "Automatic HTML Generation",
          "Automatic Tool Updates",
          "Permanent Tool Links",
          "R2 Storage",
          "Version History"
        ]
      });
    }

    // =====================================
    // 2. PUBLIC TOOL PAGE
    // =====================================

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/tools/")
    ) {
      const id = url.pathname.split("/")[2];

      if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
        return new Response("Invalid tool link", {
          status: 400,
          headers
        });
      }

      if (!env.TOOLS_BUCKET) {
        return new Response("R2 storage is not configured", {
          status: 500,
          headers
        });
      }

      try {
        const file = await env.TOOLS_BUCKET.get(id + ".html");

        if (!file) {
          return new Response("Tool not found", {
            status: 404,
            headers
          });
        }

        return new Response(file.body, {
          headers: {
            ...headers,
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff"
          }
        });

      } catch (error) {
        return new Response("Unable to load tool", {
          status: 500,
          headers
        });
      }
    }

    // =====================================
    // 3. MAIN ASK AI BUILDER
    // =====================================

    if (
      url.pathname === "/api/create" &&
      request.method === "POST"
    ) {

      if (!env.AI) {
        return json({
          success: false,
          error: "Cloudflare AI binding AI is missing"
        }, 500);
      }

      if (!env.TOOLS_BUCKET) {
        return json({
          success: false,
          error: "R2 binding TOOLS_BUCKET is missing"
        }, 500);
      }

      try {

        const body = await request.json();

        const prompt = String(body.prompt || "").trim();

        const toolName = String(
          body.toolName || body.name || "My AI Tool"
        ).trim();

        const language = String(
          body.language || "Urdu"
        );

        const requestedId = String(
          body.toolId || ""
        ).trim();

        if (!prompt) {
          return json({
            success: false,
            error: "Please write your instructions in ASK"
          }, 400);
        }

        if (prompt.length > 12000) {
          return json({
            success: false,
            error: "Prompt is too long. Maximum 12000 characters."
          }, 400);
        }

        if (requestedId && !/^[a-f0-9-]{36}$/i.test(requestedId)) {
          return json({
            success: false,
            error: "Invalid tool ID"
          }, 400);
        }

        // =================================
        // 4. LOAD EXISTING TOOL
        // =================================

        let id = requestedId;
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
              error: "Previous tool not found. Please create a new tool."
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
              error: "Existing tool is too large for automatic editing."
            }, 413);
          }

        } else {

          id = crypto.randomUUID();

        }

        // =================================
        // 5. BUILD AI INSTRUCTIONS
        // =================================

        let systemPrompt = `
You are AI Tool Maker Pro 9.

You are an expert autonomous web application developer.

Your job is to build complete, professional, functional web applications.

IMPORTANT OUTPUT RULES:

1. Return ONLY complete HTML code.
2. Start with <!DOCTYPE html>.
3. End with </html>.
4. Include HTML, CSS and JavaScript in one file.
5. Make the application responsive.
6. Make all requested buttons and features functional.
7. Use professional modern design.
8. Do not return Markdown.
9. Do not return code fences.
10. Do not return explanations outside HTML.
11. Do not create a calculator unless requested.
12. Do not invent working external APIs.
13. If an external API is required, clearly explain its requirements inside the app.
14. Do not unnecessarily remove existing functionality.
15. Use the requested language.
16. Return the COMPLETE HTML document, not a partial response.

The application must be a real usable web application,
not merely a picture or a design mockup.

The user is building with AI Tool Maker Pro 9.
`;

        let userPrompt = "";

        if (isUpdate) {

          userPrompt = `
The user already has an existing web application.

Your task is to UPDATE the existing application.

Do not create a completely unrelated application.

Keep all existing working features unless the user specifically requests their removal.

Preserve the application's identity and improve it according to the user's new instructions.

APPLICATION NAME:
${toolName}

CURRENT VERSION:
${currentVersion}

USER'S NEW ASK:
${prompt}

EXISTING COMPLETE HTML:

${previousHTML}

NOW:

Apply the user's requested changes.

Return the ENTIRE updated HTML document.

Do not return only changed sections.

Do not omit existing features that the user wants to keep.

The final output must start with <!DOCTYPE html>
and end with </html>.
`;

        } else {

          userPrompt = `
Create a brand new complete web application.

APPLICATION NAME:
${toolName}

USER'S IDEA:
${prompt}

USER INTERFACE LANGUAGE:
${language}

Create the best possible working application.

Include all important requested features.

Return the complete HTML source.
`;

        }

        // =================================
        // 6. CALL CLOUDFLARE AI
        // =================================

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
                content: userPrompt
              }
            ],
            chat_template_kwargs: {
              enable_thinking: false
            }
          }
        );

        // =================================
        // 7. EXTRACT HTML
        // =================================

        let html =
          result?.response ||
          result?.output ||
          result?.answer ||
          result?.choices?.[0]?.message?.content ||
          "";

        if (typeof html !== "string") {
          html = JSON.stringify(html);
        }

        html = html.trim();

        html = html.replace(
          /^```(?:html)?\s*/i,
          ""
        );

        html = html.replace(
          /\s*```$/,
          ""
        );

        const start = html.search(
          /<!doctype\s+html/i
        );

        if (start >= 0) {
          html = html.slice(start);
        }

        const end = html.toLowerCase().lastIndexOf(
          "</html>"
        );

        if (end >= 0) {
          html = html.slice(0, end + 7);
        }

        // =================================
        // 8. VALIDATE COMPLETE HTML
        // =================================

        if (
          !/<!doctype\s+html/i.test(html) ||
          !/<html[\s>]/i.test(html) ||
          !/<\/html>/i.test(html)
        ) {
          return json({
            success: false,
            error: "AI did not return complete HTML. Please ask again.",
            details: "The AI response may have reached its output limit."
          }, 502);
        }

        if (html.length > 2 * 1024 * 1024) {
          return json({
            success: false,
            error: "Generated HTML exceeds the 2MB limit."
          }, 413);
        }

        // =================================
        // 9. SAVE OLD VERSION
        // =================================

        const nextVersion = currentVersion + 1;

        if (isUpdate) {

          const oldHTML = previousHTML;

          const archiveKey =
            id +
            "/versions/v" +
            currentVersion +
            "-" +
            Date.now() +
            ".html";

          await env.TOOLS_BUCKET.put(
            archiveKey,
            oldHTML,
            {
              httpMetadata: {
                contentType: "text/html; charset=utf-8"
              },
              customMetadata: {
                toolId: id,
                version: String(currentVersion),
                archivedAt: new Date().toISOString()
              }
            }
          );

        }

        // =================================
        // 10. SAVE LATEST TOOL IN R2
        // =================================

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
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          }
        );

        // =================================
        // 11. PERMANENT PUBLIC LINK
        // =================================

        const publicUrl =
          url.origin + "/tools/" + id;

        // =================================
        // 12. SUCCESS RESPONSE
        // =================================

        return json({
          success: true,

          message: isUpdate
            ? "Your existing AI tool has been updated successfully."
            : "Your new AI tool has been created successfully.",

          id: id,

          toolId: id,

          toolName: toolName,

          publicUrl: publicUrl,

          html: html,

          version: nextVersion,

          previousVersionSaved: isUpdate,

          updated: isUpdate,

          size: html.length

        });

      } catch (error) {

        return json({
          success: false,
          error: error.message || "AI Tool creation failed"
        }, 500);

      }

    }

    // =====================================
    // 13. LEGACY CHAT ENDPOINT
    // =====================================

    if (
      url.pathname === "/api/chat" &&
      request.method === "POST"
    ) {

      if (!env.AI) {
        return json({
          success: false,
          error: "AI binding missing"
        }, 500);
      }

      try {

        const body = await request.json();

        const prompt = String(
          body.prompt || ""
        ).trim();

        if (!prompt) {
          return json({
            success: false,
            error: "Prompt required"
          }, 400);
        }

        const result = await env.AI.run(
          "@cf/google/gemma-4-26b-a4b-it",
          {
            messages: [
              {
                role: "system",
                content: "You are a helpful AI assistant inside AI Tool Maker Pro 9."
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

        const output =
          result?.response ||
          result?.output ||
          result?.answer ||
          "";

        return json({
          success: true,
          output: output,
          answer: output,
          response: output
        });

      } catch (error) {

        return json({
          success: false,
          error: error.message || "Chat failed"
        }, 500);

      }

    }

    // =====================================
    // 14. SERVE WEBSITE FILES
    // =====================================

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({
      success: false,
      error: "Assets binding missing"
    }, 500);

  }
};
