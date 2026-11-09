export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    const jsonCors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };

    const htmlCors = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    };


    /* =====================================================
       CORS
    ===================================================== */

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers: jsonCors
      });

    }


    /* =====================================================
       AI CHAT
    ===================================================== */

    if (
      url.pathname === "/api/chat" &&
      request.method === "POST"
    ) {

      try {

        if (!env.AI) {

          return new Response(
            JSON.stringify({
              error:
                "Cloudflare AI binding 'AI' موجود نہیں۔"
            }),
            {
              status: 500,
              headers: jsonCors
            }
          );

        }


        const body =
          await request.json();


        const prompt =
          String(
            body.prompt || ""
          ).trim();


        if (!prompt) {

          return new Response(
            JSON.stringify({
              error:
                "Prompt خالی ہے۔"
            }),
            {
              status: 400,
              headers: jsonCors
            }
          );

        }


        const result =
          await env.AI.run(
            "@cf/google/gemma-4-26b-a4b-it",
            {
              messages: [
                {
                  role: "user",
                  content: prompt
                }
              ]
            }
          );


        let output = "";


        if (
          typeof result === "string"
        ) {

          output = result;

        }

        else if (
          result &&
          typeof result.response === "string"
        ) {

          output =
            result.response;

        }

        else if (
          result &&
          result.result &&
          typeof result.result.response === "string"
        ) {

          output =
            result.result.response;

        }

        else {

          output =
            JSON.stringify(result);

        }


        if (!output.trim()) {

          return new Response(
            JSON.stringify({
              error:
                "AI نے خالی جواب دیا۔"
            }),
            {
              status: 500,
              headers: jsonCors
            }
          );

        }


        return new Response(
          JSON.stringify({
            ok: true,
            output
          }),
          {
            status: 200,
            headers: jsonCors
          }
        );


      } catch (error) {

        return new Response(
          JSON.stringify({
            error:
              "AI request failed",

            detail:
              error?.message ||
              String(error)
          }),
          {
            status: 500,
            headers: jsonCors
          }
        );

      }

    }


    /* =====================================================
       CREATE PUBLIC TOOL
    ===================================================== */

    if (
      url.pathname === "/api/tools" &&
      request.method === "POST"
    ) {

      try {

        if (!env.TOOLS_KV) {

          return new Response(
            JSON.stringify({
              error:
                "TOOLS_KV binding موجود نہیں۔ Cloudflare Bindings میں TOOLS_KV → AI_TOOLS لگائیں۔"
            }),
            {
              status: 500,
              headers: jsonCors
            }
          );

        }


        const body =
          await request.json();


        const html =
          String(
            body.html || ""
          ).trim();


        const name =
          String(
            body.name ||
            "AI Tool"
          ).trim();


        const description =
          String(
            body.description ||
            ""
          ).trim();


        if (!html) {

          return new Response(
            JSON.stringify({
              error:
                "Tool HTML خالی ہے۔"
            }),
            {
              status: 400,
              headers: jsonCors
            }
          );

        }


        /*
          Unique ID
        */

        const id =
          "tool_" +
          Date.now().toString(36) +
          "_" +
          crypto
            .randomUUID()
            .slice(0,8);


        const now =
          new Date().toISOString();


        const tool = {

          id,

          name,

          description,

          html,

          createdAt:
            now,

          updatedAt:
            now

        };


        /*
          Save into Cloudflare KV
        */

        await env.TOOLS_KV.put(
          `tool:${id}`,
          JSON.stringify(tool)
        );


        /*
          Real public Worker URL
        */

        const publicUrl =
          `${url.origin}/tool/${encodeURIComponent(id)}`;


        return new Response(
          JSON.stringify({

            ok:true,

            id,

            url:
              publicUrl,

            publicUrl:
              publicUrl,

            tool

          }),
          {
            status:201,
            headers:jsonCors
          }
        );


      } catch (error) {

        return new Response(
          JSON.stringify({

            error:
              "Tool save failed",

            detail:
              error?.message ||
              String(error)

          }),
          {
            status:500,
            headers:jsonCors
          }
        );

      }

    }


    /* =====================================================
       PUBLIC TOOL
    ===================================================== */

    if (
      url.pathname.startsWith("/tool/") &&
      request.method === "GET"
    ) {

      try {

        if (!env.TOOLS_KV) {

          return new Response(
            `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Configuration Error</title>
</head>
<body>
<h1>TOOLS_KV binding موجود نہیں۔</h1>
</body>
</html>
            `,
            {
              status:500,
              headers:htmlCors
            }
          );

        }


        const id =
          decodeURIComponent(
            url.pathname
              .slice("/tool/".length)
              .trim()
          );


        if (!id) {

          return new Response(
            "<h1>Tool ID missing</h1>",
            {
              status:400,
              headers:htmlCors
            }
          );

        }


        const value =
          await env.TOOLS_KV.get(
            `tool:${id}`
          );


        if (!value) {

          return new Response(
            `
<!doctype html>
<html lang="ur" dir="rtl">
<head>
<meta charset="utf-8">

<meta name="viewport"
content="width=device-width,initial-scale=1">

<title>Tool نہیں ملا</title>

<style>

body{
  margin:0;
  min-height:100vh;
  display:grid;
  place-items:center;
  background:#090e1c;
  color:#fff;
  font-family:system-ui,sans-serif;
}

.box{
  max-width:520px;
  padding:35px;
  text-align:center;
}

h1{
  color:#ff9baa;
}

p{
  color:#aeb9d2;
}

</style>

</head>

<body>

<div class="box">

<h1>
❌ Tool نہیں ملا
</h1>

<p>
یہ Tool موجود نہیں ہے یا Public Link غلط ہے۔
</p>

</div>

</body>
</html>
            `,
            {
              status:404,
              headers:htmlCors
            }
          );

        }


        const tool =
          JSON.parse(value);


        /*
          Saved HTML directly return
        */

        return new Response(
          tool.html,
          {
            status:200,

            headers:{
              ...htmlCors,

              "Content-Security-Policy":
                "frame-ancestors *"
            }
          }
        );

      } catch (error) {

        return new Response(
          `
<!doctype html>

<html>

<head>

<meta charset="utf-8">

<title>Tool Error</title>

</head>

<body>

<h1>
Tool Error
</h1>

<p>
${escapeHtml(
  error?.message ||
  String(error)
)}
</p>

</body>

</html>
          `,
          {
            status:500,
            headers:htmlCors
          }
        );

      }

    }


    /* =====================================================
       GET TOOL DATA
    ===================================================== */

    if (
      url.pathname.startsWith("/api/tools/") &&
      request.method === "GET"
    ) {

      try {

        if (!env.TOOLS_KV) {

          return new Response(
            JSON.stringify({
              error:
                "TOOLS_KV binding موجود نہیں۔"
            }),
            {
              status:500,
              headers:jsonCors
            }
          );

        }


        const id =
          decodeURIComponent(
            url.pathname
              .slice("/api/tools/".length)
              .trim()
          );


        if (!id) {

          return new Response(
            JSON.stringify({
              error:
                "Tool ID missing"
            }),
            {
              status:400,
              headers:jsonCors
            }
          );

        }


        const value =
          await env.TOOLS_KV.get(
            `tool:${id}`
          );


        if (!value) {

          return new Response(
            JSON.stringify({
              error:
                "Tool نہیں ملا۔"
            }),
            {
              status:404,
              headers:jsonCors
            }
          );

        }


        const tool =
          JSON.parse(value);


        const publicUrl =
          `${url.origin}/tool/${encodeURIComponent(id)}`;


        return new Response(
          JSON.stringify({

            ok:true,

            id,

            url:
              publicUrl,

            publicUrl:
              publicUrl,

            tool

          }),
          {
            status:200,
            headers:jsonCors
          }
        );


      } catch (error) {

        return new Response(
          JSON.stringify({

            error:
              "Tool fetch failed",

            detail:
              error?.message ||
              String(error)

          }),
          {
            status:500,
            headers:jsonCors
          }
        );

      }

    }


    /* =====================================================
       UPDATE TOOL
    ===================================================== */

    if (
      url.pathname.startsWith("/api/tools/") &&
      request.method === "PUT"
    ) {

      try {

        if (!env.TOOLS_KV) {

          return new Response(
            JSON.stringify({
              error:
                "TOOLS_KV binding موجود نہیں۔"
            }),
            {
              status:500,
              headers:jsonCors
            }
          );

        }


        const id =
          decodeURIComponent(
            url.pathname
              .slice("/api/tools/".length)
              .trim()
          );


        if (!id) {

          return new Response(
            JSON.stringify({
              error:
                "Tool ID missing"
            }),
            {
              status:400,
              headers:jsonCors
            }
          );

        }


        const oldValue =
          await env.TOOLS_KV.get(
            `tool:${id}`
          );


        if (!oldValue) {

          return new Response(
            JSON.stringify({
              error:
                "Tool نہیں ملا۔"
            }),
            {
              status:404,
              headers:jsonCors
            }
          );

        }


        const oldTool =
          JSON.parse(oldValue);


        const body =
          await request.json();


        const updatedTool = {

          ...oldTool,

          name:
            String(
              body.name ??
              oldTool.name
            ),

          description:
            String(
              body.description ??
              oldTool.description ??
              ""
            ),

          html:
            String(
              body.html ??
              oldTool.html
            ),

          updatedAt:
            new Date().toISOString()

        };


        await env.TOOLS_KV.put(
          `tool:${id}`,
          JSON.stringify(
            updatedTool
          )
        );


        const publicUrl =
          `${url.origin}/tool/${encodeURIComponent(id)}`;


        return new Response(
          JSON.stringify({

            ok:true,

            id,

            url:
              publicUrl,

            publicUrl:
              publicUrl,

            tool:
              updatedTool

          }),
          {
            status:200,
            headers:jsonCors
          }
        );


      } catch (error) {

        return new Response(
          JSON.stringify({

            error:
              "Tool update failed",

            detail:
              error?.message ||
              String(error)

          }),
          {
            status:500,
            headers:jsonCors
          }
        );

      }

    }


    /* =====================================================
       HEALTH CHECK
    ===================================================== */

    return new Response(
      JSON.stringify({

        ok:true,

        message:
          "AI Tool Maker Backend is running",

        ai:
          !!env.AI,

        toolsKV:
          !!env.TOOLS_KV,

        routes:[
          "/api/chat",
          "/api/tools",
          "/api/tools/:id",
          "/tool/:id"
        ]

      }),
      {
        status:200,
        headers:jsonCors
      }
    );

  }
};


/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(value){

  return String(value)

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );

}