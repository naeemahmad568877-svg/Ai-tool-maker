
const HF_URL = "https://router.huggingface.co/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b:fastest";

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    const reply = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });

    const url = new URL(request.url);

    if (url.pathname === "/health")
      return reply({ok:true, service:"AI Tool Maker Pro 9"});

    if (url.pathname.startsWith("/tools/") && request.method === "GET") {
      if (!env.TOOL_BUCKET)
        return reply({error:"R2 binding missing"},500);

      const id = url.pathname.split("/")[2];
      const file = await env.TOOL_BUCKET.get(`tools/${id}/index.html`);

      if (!file)
        return new Response("Tool not found",{status:404});

      return new Response(file.body,{
        headers:{"Content-Type":"text/html; charset=utf-8"}
      });
    }

    if (url.pathname !== "/api/create" || request.method !== "POST")
      return reply({error:"Not found"},404);

    if (!env.HF_TOKEN || !env.TOOL_BUCKET)
      return reply({error:"HF_TOKEN or TOOL_BUCKET missing"},500);

    try {
      const body = await request.json();
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return reply({error:"Prompt required"},400);

      const oldId = String(body.toolId || "");
      const id = oldId || crypto.randomUUID().replaceAll("-","").slice(0,16);

      const previous = oldId
        ? await env.TOOL_BUCKET.get(`tools/${id}/index.html`)
        : null;

      const oldHTML = previous ? await previous.text() : "";

      const ai = await fetch(HF_URL,{
        method:"POST",
        headers:{
          "Authorization":`Bearer ${env.HF_TOKEN}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:MODEL,
          messages:[
            {
              role:"system",
              content:"You are an expert web developer. Understand Urdu and Roman Urdu. Create a complete responsive working HTML app with CSS and JavaScript. Return ONLY a complete HTML document, without markdown."
            },
            {
              role:"user",
              content:oldHTML
                ? `Update this existing HTML according to: ${prompt}\nExisting HTML:\n${oldHTML.slice(0,45000)}`
                : `Create a complete working HTML tool for: ${prompt}`
            }
          ],
          max_tokens:6000,
          temperature:0.35
        })
      });

      const data = await ai.json();

      if (!ai.ok)
        return reply({error:data.error?.message || data.error || "AI error"},502);

      let html = data.choices?.[0]?.message?.content || "";
      html = html.replace(/^```html\s*/i,"").replace(/\s*```$/,"").trim();

      if (!html.includes("<html") || !html.includes("</html>"))
        return reply({error:"AI did not return complete HTML"},502);

      await env.TOOL_BUCKET.put(`tools/${id}/index.html`,html,{
        httpMetadata:{contentType:"text/html; charset=utf-8"}
      });

      return reply({
        success:true,
        id,
        toolId:id,
        html,
        publicUrl:`${url.origin}/tools/${id}`,
        version:previous ? 2 : 1,
        updated:Boolean(previous),
        message:"آپ کا ٹول کامیابی سے محفوظ ہوگیا!"
      });

    } catch(error) {
      return reply({error:error.message},500);
    }
  }
};
