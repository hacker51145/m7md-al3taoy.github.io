
const http = require("node:http");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;
const SITE_ORIGIN = process.env.SITE_ORIGIN || "*";

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

async function askGemini(model, message) {
  const retryable = [429, 500, 502, 503, 504];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{
                text: "أنت MOHAMED AI، مساعد شخصي ودود يتحدث بالعربية باللهجة السعودية بشكل طبيعي ومختصر. كن مفيداً وواضحاً."
              }]
            },
            contents: [{
              role: "user",
              parts: [{ text: message }]
            }],
            generationConfig: {
              maxOutputTokens: 700
            }
          }),
          signal: AbortSignal.timeout(30000)
        }
      );

      const data = await response.json();

      if (response.ok) {
        const reply = data.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("")
          .trim();

        if (reply) return { reply };
      }

      if (!retryable.includes(response.status)) {
        return {
          error: data.error?.message || "Gemini API error",
          status: response.status
        };
      }

      if (attempt === 0) await wait(1500);

    } catch (error) {
      if (attempt === 0) {
        await wait(1500);
      } else {
        return { error: "تعذر الاتصال بخدمة الذكاء الاصطناعي." };
      }
    }
  }

  return { error: "النموذج مشغول حالياً." };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/") {
    return send(res, 200, {
      ok: true,
      service: "MOHAMED AI API",
      primary: PRIMARY_MODEL,
      fallback: FALLBACK_MODEL
    });
  }

  if (req.method !== "POST" || req.url !== "/api/chat") {
    return send(res, 404, { error: "Not found" });
  }

  if (!API_KEY) {
    return send(res, 500, {
      error: "GEMINI_API_KEY is not configured."
    });
  }

  let raw = "";

  req.on("data", chunk => {
    raw += chunk;
    if (raw.length > 20000) {
      req.destroy();
    }
  });

  req.on("end", async () => {
    try {
      const body = JSON.parse(raw || "{}");
      const message = String(body.message || "").trim();

      if (!message) {
        return send(res, 400, { error: "اكتب رسالتك أولاً." });
      }

      if (message.length > 4000) {
        return send(res, 400, { error: "الرسالة طويلة جداً." });
      }

      // المحاولة بالنموذج الأساسي
      let result = await askGemini(PRIMARY_MODEL, message);

      if (result.reply) {
        return send(res, 200, {
          reply: result.reply,
          model: PRIMARY_MODEL
        });
      }

      // الانتقال للنموذج الاحتياطي
      console.log("Primary model failed. Trying fallback...");

      result = await askGemini(FALLBACK_MODEL, message);

      if (result.reply) {
        return send(res, 200, {
          reply: result.reply,
          model: FALLBACK_MODEL
        });
      }

      return send(res, 503, {
        error: "النموذجان مشغولان حالياً. حاول بعد قليل."
      });

    } catch (error) {
      console.error(error);
      return send(res, 500, {
        error: "حدث خطأ في الخادم."
      });
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("MOHAMED AI API listening on " + PORT);
});
