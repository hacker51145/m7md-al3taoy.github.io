const http = require("node:http");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;
const SITE_ORIGIN = process.env.SITE_ORIGIN || "*";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    return send(res, 200, { ok: true, service: "MOHAMED AI API" });
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    return send(res, 404, { error: "Not found" });
  }

  let raw = "";
  req.on("data", chunk => raw += chunk);

  req.on("end", async () => {
    try {
      if (!API_KEY) {
        return send(res, 500, {
          error: "GEMINI_API_KEY is not configured on the server."
        });
      }

      const body = JSON.parse(raw || "{}");
      const message = String(body.message || "").trim();

      if (!message) {
        return send(res, 400, { error: "اكتب رسالتك أولاً." });
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{
                text: "أنت MOHAMED AI، مساعد شخصي يتحدث بالعربية باللهجة السعودية. كن ودوداً ومفيداً."
              }]
            },
            contents: [{
              role: "user",
              parts: [{ text: message }]
            }]
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return send(res, response.status, {
          error: data.error?.message || "Gemini API error"
        });
      }

      const reply = data.candidates?.[0]?.content?.parts
        ?.map(p => p.text || "").join("") || "حاول مرة ثانية.";

      return send(res, 200, { reply });

    } catch (error) {
      return send(res, 500, { error: "حدث خطأ في الخادم." });
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("MOHAMED AI API listening on " + PORT);
});
