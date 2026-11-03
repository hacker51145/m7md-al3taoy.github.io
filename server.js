const http = require("node:http");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.OPENAI_API_KEY;
const SITE_ORIGIN = process.env.SITE_ORIGIN || "*";
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const hits = new Map();
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    return send(res, 200, { ok: true, service: "MOHAMED AI API" });
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    return send(res, 404, { error: "Not found" });
  }

  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const previous = hits.get(ip) || [];
  const recent = previous.filter(t => now - t < 60_000);
  if (recent.length >= 12) return send(res, 429, { error: "طلبات كثيرة. انتظر دقيقة وجرب مرة ثانية." });
  recent.push(now);
  hits.set(ip, recent);

  let raw = "";
  req.on("data", chunk => {
    raw += chunk;
    if (raw.length > 20_000) req.destroy();
  });

  req.on("end", async () => {
    try {
      if (!API_KEY) return send(res, 500, { error: "OPENAI_API_KEY is not configured on the server." });
      const body = JSON.parse(raw || "{}");
      const message = String(body.message || "").trim();
      if (!message) return send(res, 400, { error: "اكتب رسالتك أولاً." });
      if (message.length > 4000) return send(res, 400, { error: "الرسالة طويلة جداً." });

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          instructions: "أنت MOHAMED AI، مساعد شخصي ودود يتحدث بالعربية باللهجة السعودية بشكل طبيعي ومختصر. كن مفيداً وواضحاً ولا تدّع تنفيذ أشياء لا تستطيع تنفيذها.",
          input: message,
          max_output_tokens: 700
        })
      });

      const data = await response.json();
      if (!response.ok) {
        const message = data && data.error && data.error.message ? data.error.message : "OpenAI API request failed";
        return send(res, response.status, { error: message });
      }
      return send(res, 200, { reply: data.output_text || "ما قدرت أطلع رد نصي، جرّب مرة ثانية." });
    } catch (err) {
      return send(res, 500, { error: "صار خطأ في الخادم. تأكد من الإعدادات وحاول مرة ثانية." });
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MOHAMED AI API listening on ${PORT}`);
});
