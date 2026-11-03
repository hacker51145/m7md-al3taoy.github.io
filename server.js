
const http = require("node:http");
const webpush = require("web-push");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;
const SITE_ORIGIN = process.env.SITE_ORIGIN || "*";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.8-flash";

const FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type"
  });

  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (raw.length > 20000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

async function supabase(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Supabase error:", error);
    throw new Error("Supabase request failed");
  }

  return response.status === 204
    ? null
    : response.json();
}

async function askGemini(model, message) {
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

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Gemini API error"
    );
  }

  const reply = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!reply) {
    throw new Error("Empty Gemini response");
  }

  return reply;
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(
    req.url,
    "http://localhost"
  ).pathname;

  console.log("REQUEST:", req.method, pathname);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type"
    });

    return res.end();
  }

  try {

    // فحص الخادم
    if (req.method === "GET" && pathname === "/") {
      return send(res, 200, {
        ok: true,
        service: "MOHAMED AI API",
        primary: PRIMARY_MODEL,
        fallback: FALLBACK_MODEL
      });
    }

    // إرسال المفتاح العام للواجهة
    if (
      req.method === "GET" &&
      pathname === "/api/push/public-key"
    ) {
      if (!VAPID_PUBLIC_KEY) {
        return send(res, 500, {
          error: "VAPID public key is missing"
        });
      }

      return send(res, 200, {
        publicKey: VAPID_PUBLIC_KEY
      });
    }

    // تسجيل اشتراك الإشعارات في Supabase
    if (
      req.method === "POST" &&
      pathname === "/api/push/subscribe"
    ) {
      if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return send(res, 500, {
          error: "VAPID is not configured"
        });
      }

      const body = await readBody(req);
      const sub = body.subscription;

      if (
        !sub ||
        !sub.endpoint ||
        !sub.keys ||
        !sub.keys.p256dh ||
        !sub.keys.auth ||
        !sub.endpoint.startsWith("https://")
      ) {
        return send(res, 400, {
          error: "Invalid subscription"
        });
      }

      await supabase(
        "push_subscriptions?on_conflict=endpoint",
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates"
          },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            subscription: sub
          })
        }
      );

      return send(res, 200, {
        ok: true,
        message: "Subscription saved"
      });
    }

    // المحادثة مع Gemini
    if (
      req.method === "POST" &&
      pathname === "/api/chat"
    ) {
      if (!API_KEY) {
        return send(res, 500, {
          error: "Gemini API key missing"
        });
      }

      const body = await readBody(req);
      const message = String(body.message || "").trim();

      if (!message) {
        return send(res, 400, {
          error: "اكتب رسالتك أولاً."
        });
      }

      if (message.length > 4000) {
        return send(res, 400, {
          error: "الرسالة طويلة جداً."
        });
      }

      try {
        const reply = await askGemini(
          PRIMARY_MODEL,
          message
        );

        return send(res, 200, {
          reply,
          model: PRIMARY_MODEL
        });

      } catch (error) {
        console.log(
          "Primary model failed:",
          error.message
        );
      }

      try {
        const reply = await askGemini(
          FALLBACK_MODEL,
          message
        );

        return send(res, 200, {
          reply,
          model: FALLBACK_MODEL
        });

      } catch (error) {
        console.error(
          "Fallback model failed:",
          error.message
        );

        return send(res, 503, {
          error: "النموذجان مشغولان حالياً. حاول بعد قليل."
        });
      }
    }

    return send(res, 404, {
      error: "Not found"
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return send(res, 500, {
      error: "حدث خطأ في الخادم."
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "MOHAMED AI API running on port " + PORT
  );
});
