
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const MAX_PROMPT_LENGTH = 12000;
const MAX_HTML_SIZE = 2 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

// ========================================
// 1. JSON RESPONSE
// ========================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

// ========================================
// 2. TEXT EXTRACTION
// ========================================

function extractText(result) {
  if (typeof result === "string") {
    return result.trim();
  }

  const candidates = [
    result?.response,
    result?.output,
    result?.answer,
    result?.text,
    result?.choices?.[0]?.message?.content,
    result?.result?.response,
    result?.result?.output
  ];

  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }

    if (Array.isArray(item)) {
      const text = item.map(part => {
        if (typeof part === "string") return part;
        return part?.text || "";
      }).join("");

      if (text.trim()) return text.trim();
    }

    if (item && typeof item === "object") {
      if (typeof item.text === "string") {
        return item.text.trim();
      }
    }
  }

  return "";
}

// ========================================
// 3. CLEAN HTML
// ========================================

function cleanHTML(value) {
  let html = String(value || "").trim();

  html = html.replace(/^```(?:html)?\s*/i, "");
  html = html.replace(/\s*```$/i, "");

  const start = html.search(
    /<!doctype\s+html|<html[\s>]/i
  );

  if (start >= 0) {
    html = html.slice(start);
  }

  const end = html.toLowerCase().lastIndexOf("</html>");

  if (end >= 0) {
    html = html.slice(0, end + 7);
  }

  return html.trim();
}

// ========================================
// 4. VALIDATE PROMPT
// ========================================

function validatePrompt(prompt) {
  if (!prompt) {
    return "Please enter your instructions.";
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return "Prompt is too long. Maximum 12000 characters.";
  }

  return "";
}

// ========================================
// 5. REAL CLOUDFLARE AI
// ========================================

async function callAI(env, messages) {
  if (!env.AI) {
    throw new Error(
      "Cloudflare AI binding is missing. Check Workers AI binding."
    );
  }

  let result;

  try {
    result = await env.AI.run(MODEL, {
      messages,
      max_tokens: 8192,
      temperature: 0.2
    });
  } catch (error) {
    throw new Error(
      "Cloudflare AI Model Error: " + error.message
    );
  }

  const output = extractText(result);

  if (!output) {
    throw new Error(
      "AI returned an empty response. Check the model and Cloudflare AI logs."
    );
  }

  return output;
}

// ========================================
// 6. AI CHAT SYSTEM
// ========================================

async function handleChat(request, env) {
  const body = await request.json();

  const prompt = String(body.prompt || "").trim();

  const task = String(body.task || "chat");

  const language = String(body.language || "Urdu");

  const error = validatePrompt(prompt);

  if (error) {
    return json({
      success: false,
      error
    }, 400);
  }

  let systemPrompt;

  if (task === "build_html") {

    systemPrompt = `
You are AI Tool Maker Pro 8.2.

You are an expert professional web application developer.

YOUR TASK:
Build a complete working web application from the user's instructions.

STRICT REQUIREMENTS:

1. Return ONLY complete HTML code.
2. Start with <!DOCTYPE html>.
3. End with </html>.
4. Include CSS and JavaScript in the same HTML file.
5. Make the application fully responsive.
6. Support mobile phones.
7. Make all requested buttons functional.
8. Use a professional modern interface.
9. Follow the user's requested language.
10. Do not return Markdown.
11. Do not use code fences.
12. Do not return explanations outside HTML.
13. Never invent API connections.
14. Clearly indicate when external API access is required.
15. Do not expose API keys.
16. Use working JavaScript.
17. Build a real usable application, not a mockup.
18. Include error handling.
19. Do not create unrelated features.
20. Return the complete HTML document.

INTERFACE LANGUAGE: ${language}

Return complete HTML only.
`;

  } else {

    systemPrompt = `
You are AI Tool Maker Pro 8.2.

You are a helpful, intelligent AI assistant.

Answer accurately and clearly.

Use the user's requested language: ${language}.

Help with programming, writing, ideas, explanations and app development.
`;

  }

  const output = await callAI(env, [
    {
      role: "system",
      content: systemPrompt
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
    response: output,
    task,
    model: MODEL
  });
}

// ========================================
// 7. CREATE OR UPDATE TOOL
// ========================================

async function handleCreate(request, env, url) {
  if (!env.AI) {
    return json({
      success: false,
      error: "Cloudflare AI binding is missing."
    }, 500);
  }

  if (!env.TOOLS_BUCKET) {
    return json({
      success: false,
      error: "R2 storage is not connected. Add TOOLS_BUCKET binding."
    }, 503);
  }

  const body = await request.json();

  const prompt = String(body.prompt || "").trim();

  const toolName = String(
    body.toolName || body.name || "My AI Tool"
  ).trim().slice(0, 100);

  const language = String(body.language || "Urdu");

  let id = String(body.toolId || "").trim();

  const error = validatePrompt(prompt);

  if (error) {
    return json({
      success: false,
      error
    }, 400);
  }

  if (id && !/^[a-f0-9-]{36}$/i.test(id)) {
    return json({
      success: false,
      error: "Invalid tool ID."
    }, 400);
  }

  let previousHTML = "";
  let currentVersion = 0;
  let isUpdate = false;

  // Load existing tool

  if (id) {
    const existing = await env.TOOLS_BUCKET.get(id + ".html");

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

    if (previousHTML.length > MAX_HTML_SIZE) {
      return json({
        success: false,
        error: "Existing HTML is too large."
      }, 413);
    }

  } else {
    id = crypto.randomUUID();
  }

  // AI developer instructions

  const systemPrompt = `
You are AI Tool Maker Pro 8.2.

You are an expert full-stack web application developer.

STRICT OUTPUT RULES:

1. Return ONLY complete HTML.
2. Start with <!DOCTYPE html>.
3. End with </html>.
4. Include HTML, CSS and JavaScript in one file.
5. Make the application mobile responsive.
6. Make all requested buttons functional.
7. Use a professional modern interface.
8. Do not return Markdown or code fences.
9. Do not invent external API connections.
10. Clearly explain external API requirements inside the application.
11. Preserve existing functionality when updating.
12. Follow the requested language.
13. Return the entire HTML document.
14. Use safe and functional JavaScript.
15. Do not return a design mockup.
16. Build a genuinely usable application.

Return complete HTML only.
`;

  let userPrompt;

  if (isUpdate) {
    userPrompt = `
UPDATE THE EXISTING APPLICATION.

Application name: ${toolName}

Current version: ${currentVersion}

User's new instructions:

${prompt}

EXISTING HTML:

${previousHTML}

Preserve all existing functionality.
Implement the requested changes.
Return the complete updated HTML document.
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

  // Call AI

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

  // Validate HTML

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

  if (html.length > MAX_HTML_SIZE) {
    return json({
      success: false,
      error: "Generated HTML exceeds 2MB."
    }, 413);
  }

  // Save previous version

  if (isUpdate) {
    const archiveKey =
      id + "/versions/v" + currentVersion +
      "-" + Date.now() + ".html";

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

  // Save new tool

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

  const publicUrl = url.origin + "/tools/" + id;

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

// ========================================
// 8. PUBLIC TOOL VIEWER
// ========================================

async function handlePublicTool(id, env) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    return new Response("Invalid tool ID.", {
      status: 400,
      headers: corsHeaders
    });
  }

  if (!env.TOOLS_BUCKET) {
    return new Response("R2 storage is not connected.", {
      status: 503,
      headers: corsHeaders
    });
  }

  const file = await env.TOOLS_BUCKET.get(id + ".html");

  if (!file) {
    return new Response("Tool not found.", {
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

// ========================================
// 9. VERSION HISTORY
// ========================================

async function handleVersions(id, env) {
  if (!env.TOOLS_BUCKET) {
    return json({
      success: false,
      error: "R2 storage is not connected."
    }, 503);
  }

  if (!/^[a-f0-9-]{36}$/i.test(id)) {
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

// ========================================
// 10. MAIN WORKER
// ========================================

export default {
  async fetch(request, env) {

    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    try {

      // HEALTH CHECK

      if (
        path === "/api/health" &&
        request.method === "GET"
      ) {
        return json({
          success: true,
          name: "AI Tool Maker Pro 8.2",
          aiBinding: !!env.AI,
          storageBinding: !!env.TOOLS_BUCKET,
          model: MODEL,
          features: [
            "Real Cloudflare AI",
            "AI Chat",
            "Automatic HTML Generation",
            "Tool Creation",
            "Tool Updates",
            "Permanent Tool Links",
            "R2 Storage",
            "Version History",
            "Urdu and English Support"
          ]
        });
      }

      // AI CHAT AND HTML BUILDER

      if (
        path === "/api/chat" &&
        request.method === "POST"
      ) {
        return await handleChat(request, env);
      }

      // CREATE OR UPDATE TOOL

      if (
        path === "/api/create" &&
        request.method === "POST"
      ) {
        return await handleCreate(request, env, url);
      }

      // PUBLIC TOOL

      if (
        path.startsWith("/tools/") &&
        request.method === "GET"
      ) {
        const id = path.slice("/tools/".length);

        return await handlePublicTool(id, env);
      }

      // VERSION HISTORY

      if (
        path.startsWith("/api/versions/") &&
        request.method === "GET"
      ) {
        const id = path.slice("/api/versions/".length);

        return await handleVersions(id, env);
      }

      // WEBSITE ASSETS

      if (env.ASSETS) {
        return await env.ASSETS.fetch(request);
      }

      return json({
        success: false,
        error: "API route not found.",
        path
      }, 404);

    } catch (error) {

      console.error("Worker Error:", error);

      return json({
        success: false,
        error: error.message || "Internal server error."
      }, 500);

    }
  }
};
