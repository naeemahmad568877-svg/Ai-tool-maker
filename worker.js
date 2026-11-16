const MODEL = "@cf/google/gemma-4-26b-a4b-it";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function corsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

function makeId() {
  return (
    "tool-" +
    Date.now().toString(36) +
    "-" +
    crypto.randomUUID().slice(0, 8)
  );
}

function cleanText(value, max = 200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function extractAIText(result) {
  if (!result) return "";

  if (typeof result === "string") {
    return result;
  }

  if (typeof result.response === "string") {
    return result.response;
  }

  if (typeof result.output === "string") {
    return result.output;
  }

  if (typeof result.text === "string") {
    return result.text;
  }

  if (Array.isArray(result)) {
    return result
      .map(x => extractAIText(x))
      .filter(Boolean)
      .join("\n");
  }

  if (result.choices && Array.isArray(result.choices)) {
    return result.choices
      .map(choice => {
        if (choice?.message?.content) {
          return choice.message.content;
        }

        if (choice?.text) {
          return choice.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (result.result) {
    return extractAIText(result.result);
  }

  return "";
}

function getToolKey(id) {
  return "tool:" + id;
}

function getToolIndexKey() {
  return "tools:index";
}

async function getToolIndex(env) {
  try {
    const data = await env.TOOLS_KV.get(
      getToolIndexKey(),
      "json"
    );

    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function saveToolIndex(env, list) {
  await env.TOOLS_KV.put(
    getToolIndexKey(),
    JSON.stringify(list)
  );
}

function publicUrl(request, id) {
  const url = new URL(request.url);
  return (
    url.origin +
    "/tool/" +
    encodeURIComponent(id)
  );
}

async function createTool(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (e) {
    return json({
      ok: false,
      error: "Invalid JSON body."
    }, 400);
  }

  const html = String(body.html || "").trim();

  if (!html) {
    return json({
      ok: false,
      error: "HTML missing."
    }, 400);
  }

  const id = makeId();

  const now = new Date().toISOString();

  const tool = {
    id,
    name: cleanText(
      body.name || "AI Tool",
      100
    ),
    description: cleanText(
      body.description || "",
      300
    ),
    html,
    createdAt: now,
    updatedAt: now
  };

  await env.TOOLS_KV.put(
    getToolKey(id),
    JSON.stringify(tool)
  );

  const index = await getToolIndex(env);

  index.unshift({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
    publicUrl: publicUrl(request, id)
  });

  await saveToolIndex(env, index);

  return json({
    ok: true,
    id,
    publicUrl: publicUrl(request, id),
    tool: {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt
    }
  });
}

async function listTools(env, request) {
  const index = await getToolIndex(env);

  const tools = index.map(item => ({
    ...item,
    publicUrl:
      item.publicUrl ||
      publicUrl(request, item.id)
  }));

  return json({
    ok: true,
    tools
  });
}

async function getTool(request, env, id) {
  const raw =
    await env.TOOLS_KV.get(
      getToolKey(id)
    );

  if (!raw) {
    return json({
      ok: false,
      error: "Tool not found."
    }, 404);
  }

  let tool;

  try {
    tool = JSON.parse(raw);
  } catch (e) {
    return json({
      ok: false,
      error: "Saved Tool data is corrupted."
    }, 500);
  }

  return json({
    ok: true,
    tool: {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      html: tool.html,
      createdAt: tool.createdAt,
      updatedAt: tool.updatedAt,
      publicUrl:
        publicUrl(request, id)
    }
  });
}

async function updateTool(request, env, id) {
  const raw =
    await env.TOOLS_KV.get(
      getToolKey(id)
    );

  if (!raw) {
    return json({
      ok: false,
      error: "Tool not found."
    }, 404);
  }

  let oldTool;

  try {
    oldTool = JSON.parse(raw);
  } catch (e) {
    return json({
      ok: false,
      error: "Existing Tool data is corrupted."
    }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch (e) {
    return json({
      ok: false,
      error: "Invalid JSON body."
    }, 400);
  }

  const html =
    String(
      body.html ??
      oldTool.html ??
      ""
    ).trim();

  if (!html) {
    return json({
      ok: false,
      error: "HTML missing."
    }, 400);
  }

  const updated = {
    ...oldTool,

    id,

    name:
      cleanText(
        body.name ??
        oldTool.name ??
        "AI Tool",
        100
      ),

    description:
      cleanText(
        body.description ??
        oldTool.description ??
        "",
        300
      ),

    html,

    updatedAt:
      new Date().toISOString()
  };

  await env.TOOLS_KV.put(
    getToolKey(id),
    JSON.stringify(updated)
  );

  const index =
    await getToolIndex(env);

  const existingIndex =
    index.findIndex(
      item => item.id === id
    );

  const metadata = {
    id,
    name: updated.name,
    description: updated.description,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    publicUrl:
      publicUrl(request, id)
  };

  if (existingIndex >= 0) {
    index[existingIndex] =
      metadata;
  } else {
    index.unshift(metadata);
  }

  await saveToolIndex(
    env,
    index
  );

  return json({
    ok: true,
    id,
    publicUrl:
      publicUrl(request, id),
    tool: metadata
  });
}

async function deleteTool(env, id) {
  const raw =
    await env.TOOLS_KV.get(
      getToolKey(id)
    );

  if (!raw) {
    return json({
      ok: false,
      error: "Tool not found."
    }, 404);
  }

  await env.TOOLS_KV.delete(
    getToolKey(id)
  );

  const index =
    await getToolIndex(env);

  const newIndex =
    index.filter(
      item => item.id !== id
    );

  await saveToolIndex(
    env,
    newIndex
  );

  return json({
    ok: true,
    message: "Tool deleted."
  });
}

async function runAI(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (e) {
    return json({
      ok: false,
      error: "Invalid JSON body."
    }, 400);
  }

  const prompt =
    String(body.prompt || "").trim();

  if (!prompt) {
    return json({
      ok: false,
      error: "Prompt missing."
    }, 400);
  }

  const language =
    String(
      body.language ||
      "Urdu"
    );

  try {
    const result =
      await env.AI.run(
        MODEL,
        {
          messages: [
            {
              role: "system",
              content:
                "You are an expert web application builder. Return complete working HTML when requested."
            },
            {
              role: "user",
              content:
                prompt +
                "\n\nLanguage: " +
                language
            }
          ]
        }
      );

    const output =
      extractAIText(result).trim();

    if (!output) {
      return json({
        ok: false,
        error:
          "Cloudflare AI returned an empty response."
      }, 502);
    }

    return json({
      ok: true,
      output
    });

  } catch (error) {

    return json({
      ok: false,
      error:
        "Cloudflare AI failed: " +
        String(
          error?.message ||
          error
        )
    }, 500);

  }
}

async function handleRequest(request, env) {

  if (request.method === "OPTIONS") {
    return corsResponse();
  }

  const url =
    new URL(request.url);

  const path =
    url.pathname.replace(
      /\/+$/,
      ""
    ) || "/";


  /* =========================
     AI
  ========================= */

  if (
    path === "/api/chat" &&
    request.method === "POST"
  ) {

    return runAI(
      request,
      env
    );

  }


  /* =========================
     TOOLS API
  ========================= */

  if (
    path === "/api/tools" &&
    request.method === "GET"
  ) {

    return listTools(
      env,
      request
    );

  }


  if (
    path === "/api/tools" &&
    request.method === "POST"
  ) {

    return createTool(
      request,
      env
    );

  }


  const toolMatch =
    path.match(
      /^\/api\/tools\/([^/]+)$/
    );


  if (
    toolMatch &&
    request.method === "GET"
  ) {

    return getTool(
      request,
      env,
      decodeURIComponent(
        toolMatch[1]
      )
    );

  }


  if (
    toolMatch &&
    request.method === "PUT"
  ) {

    return updateTool(
      request,
      env,
      decodeURIComponent(
        toolMatch[1]
      )
    );

  }


  if (
    toolMatch &&
    request.method === "DELETE"
  ) {

    return deleteTool(
      env,
      decodeURIComponent(
        toolMatch[1]
      )
    );

  }


  /* =========================
     PUBLIC TOOL
  ========================= */

  const publicMatch =
    path.match(
      /^\/tool\/([^/]+)$/
    );


  if (
    publicMatch &&
    request.method === "GET"
  ) {

    const id =
      decodeURIComponent(
        publicMatch[1]
      );


    const raw =
      await env.TOOLS_KV.get(
        getToolKey(id)
      );


    if (!raw) {

      return new Response(
        "<h1>Tool Not Found</h1>",
        {
          status:404,
          headers:{
            "Content-Type":
              "text/html; charset=utf-8"
          }
        }
      );

    }


    let tool;

    try {

      tool =
        JSON.parse(raw);

    } catch (e) {

      return new Response(
        "<h1>Tool data error</h1>",
        {
          status:500,
          headers:{
            "Content-Type":
              "text/html; charset=utf-8"
          }
        }
      );

    }


    return htmlResponse(
      tool.html
    );

  }


  /* =========================
     HEALTH
  ========================= */

  if (
    path === "/api/health"
  ) {

    return json({
      ok:true,
      service:
        "AI Tool Maker Pro 10",
      ai:
        !!env.AI,
      kv:
        !!env.TOOLS_KV
    });

  }


  return json({
    ok:true,
    message:
      "AI Tool Maker Pro 10 Worker is running.",
    routes:[
      "/api/chat",
      "/api/tools",
      "/api/health"
    ]
  });

}


export default {
  async fetch(request, env) {
    return handleRequest(
      request,
      env
    );
  }
};