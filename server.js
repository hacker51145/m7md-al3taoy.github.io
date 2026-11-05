
const http = require("node:http");
const webpush = require("web-push");
const crypto = require("node:crypto");

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.GEMINI_API_KEY;
const SITE_ORIGIN = process.env.SITE_ORIGIN || "*";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

const SYSTEM_PROMPT =
  "أنت رايق ومسبب حرايق (MOHAMED AI)، مساعد شخصي ودود يتحدث بالعربية باللهجة السعودية بشكل طبيعي ومختصر. كن مفيداً وواضحاً. إذا سألك أي شخص: من صنعك؟ أو من مطورك؟ أو من برمجك؟ فأجب بهذه العبارة حرفياً: أنا رايق ومسبب حرايق، صنعني محمد العطاوي عشان أخدمكم. لا تقل إن Google أو Gemini صنعك؛ محمد العطاوي هو صانع رايق ومسبب حرايق، أما Google أو Gemini فهي تقنيات تشغيل فقط وليست صانعك. لا تستخدم عبارة التعريف هذه إلا عندما يكون السؤال عن صانعك أو مطورك.";

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

function readBody(req, maxBytes = 22 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > maxBytes) {
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

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Supabase
async function supabase(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const result = await response.text();

  if (!response.ok) {
    console.error("Supabase error:", result);
    throw new Error("Supabase request failed");
  }

  if (!result.trim()) return null;

  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

async function getMember(roomId, token) {
  if (!roomId || !token) return null;

  const hash = hashToken(String(token));
  const rows = await supabase(
    `room_members?room_id=eq.${encodeURIComponent(roomId)}&access_token_hash=eq.${hash}&select=id,room_id,display_name,role,status`
  );

  return rows?.[0] || null;
}

async function requireApprovedMember(roomId, token) {
  const member = await getMember(roomId, token);

  if (!member || member.status !== "approved") {
    return null;
  }

  return member;
}

async function requireOwner(roomId, token) {
  const member = await requireApprovedMember(roomId, token);

  if (!member || member.role !== "owner") {
    return null;
  }

  return member;
}

// أدوات حفظ وتشغيل المقاطع الصوتية الخاصة بالغرفة
async function uploadRoomAudio(path, buffer, mimeType) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/chat-audio/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": mimeType,
        "x-upsert": "false"
      },
      body: buffer
    }
  );

  if (!response.ok) {
    console.error("Audio storage upload failed:", await response.text());
    throw new Error("تعذر حفظ المقطع الصوتي.");
  }
}

async function createRoomAudioUrl(path) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/chat-audio/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expiresIn: 3600 })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.signedURL) {
    console.error("Audio signed URL failed:", data);
    throw new Error("تعذر تجهيز تشغيل المقطع.");
  }

  return data.signedURL.startsWith("http")
    ? data.signedURL
    : `${SUPABASE_URL}/storage/v1${data.signedURL}`;
}

// إرسال التسجيل الصوتي إلى Gemini ليستمع إليه مباشرة
async function askGeminiWithAudio(model, base64Audio, history, senderName) {
  const contents = [
    ...history.map(item => ({
      role: item.sender_type === "assistant" ? "model" : "user",
      parts: [{
        text: `${item.sender_name}: ${item.message_type === "audio" ? "أرسل رسالة صوتية." : item.content}`
      }]
    })),
    {
      role: "user",
      parts: [
        {
          text: `هذه رسالة صوتية من ${senderName}. استمع إليها وافهم المقصود، ثم أجب عنها مباشرة بالعربية السعودية. لا تعرض تفريغاً حرفياً للصوت؛ أرسل رداً طبيعياً على محتواه.`
        },
        {
          inline_data: {
            mime_type: "audio/wav",
            data: base64Audio
          }
        }
      ]
    }
  ];

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
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents,
        generationConfig: {
          maxOutputTokens: 700
        }
      }),
      signal: AbortSignal.timeout(60000)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Gemini audio error");
  }

  const reply = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!reply) throw new Error("Empty audio response");

  return reply;
}

async function getGeminiAudioReply(base64Audio, history, senderName) {
  try {
    return {
      reply: await askGeminiWithAudio(
        PRIMARY_MODEL,
        base64Audio,
        history,
        senderName
      ),
      model: PRIMARY_MODEL
    };
  } catch (error) {
    console.log("Primary audio model failed:", error.message);
  }

  try {
    return {
      reply: await askGeminiWithAudio(
        FALLBACK_MODEL,
        base64Audio,
        history,
        senderName
      ),
      model: FALLBACK_MODEL
    };
  } catch (error) {
    console.error("Fallback audio model failed:", error.message);
    throw new Error("تعذر فهم التسجيل الصوتي حالياً. حاول مرة ثانية.");
  }
}

// Gemini للرسائل النصية
async function askGemini(model, message, history = []) {
  const contents = [
    ...history.map(item => ({
      role: item.sender_type === "assistant" ? "model" : "user",
      parts: [{ text: `${item.sender_name}: ${item.content}` }]
    })),
    {
      role: "user",
      parts: [{ text: message }]
    }
  ];

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
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents,
        generationConfig: {
          maxOutputTokens: 700
        }
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Gemini API error");
  }

  const reply = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("")
    .trim();

  if (!reply) throw new Error("Empty Gemini response");

  return reply;
}

async function getGeminiReply(message, history = []) {
  try {
    return {
      reply: await askGemini(PRIMARY_MODEL, message, history),
      model: PRIMARY_MODEL
    };
  } catch (error) {
    console.log("Primary model failed:", error.message);
  }

  try {
    return {
      reply: await askGemini(FALLBACK_MODEL, message, history),
      model: FALLBACK_MODEL
    };
  } catch (error) {
    console.error("Fallback model failed:", error.message);
    throw new Error("النموذجان مشغولان حالياً. حاول بعد قليل.");
  }
}

// Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

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

    // المفتاح العام للإشعارات
    if (req.method === "GET" && pathname === "/api/push/public-key") {
      if (!VAPID_PUBLIC_KEY) {
        return send(res, 500, { error: "VAPID public key is missing" });
      }

      return send(res, 200, { publicKey: VAPID_PUBLIC_KEY });
    }

    // تسجيل اشتراك الإشعارات
    if (req.method === "POST" && pathname === "/api/push/subscribe") {
      if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return send(res, 500, { error: "VAPID is not configured" });
      }

      const body = await readBody(req);
      const sub = body.subscription;

      if (
        !sub ||
        !sub.endpoint ||
        !sub.keys?.p256dh ||
        !sub.keys?.auth ||
        !sub.endpoint.startsWith("https://")
      ) {
        return send(res, 400, { error: "Invalid subscription" });
      }

      await supabase("push_subscriptions?on_conflict=endpoint", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          subscription: sub
        })
      });

      return send(res, 200, { ok: true, message: "Subscription saved" });
    }

    // إنشاء غرفة جديدة وتعيين صاحبها
    if (req.method === "POST" && pathname === "/api/rooms/create") {
      const body = await readBody(req);
      const ownerName = String(body.ownerName || "").trim();

      if (!ownerName || ownerName.length > 40) {
        return send(res, 400, { error: "اكتب اسمك بشكل صحيح." });
      }

      const inviteCode = crypto.randomBytes(18).toString("hex");
      const accessToken = newToken();

      const rooms = await supabase("chat_rooms", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ invite_code: inviteCode })
      });

      const room = rooms?.[0];
      if (!room) throw new Error("Room creation failed");

      const members = await supabase("room_members", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          room_id: room.id,
          display_name: ownerName,
          access_token_hash: hashToken(accessToken),
          role: "owner",
          status: "approved"
        })
      });

      const owner = members?.[0];
      if (!owner) throw new Error("Owner creation failed");

      await supabase(`chat_rooms?id=eq.${room.id}`, {
        method: "PATCH",
        body: JSON.stringify({ owner_member_id: owner.id })
      });

      return send(res, 201, {
        ok: true,
        roomId: room.id,
        inviteCode,
        accessToken,
        memberId: owner.id,
        role: "owner"
      });
    }

    // طلب انضمام صديق
    if (req.method === "POST" && pathname === "/api/rooms/join") {
      const body = await readBody(req);
      const inviteCode = String(body.inviteCode || "").trim();
      const displayName = String(body.displayName || "").trim();

      if (!inviteCode || !displayName || displayName.length > 40) {
        return send(res, 400, { error: "تأكد من رابط الدعوة واسمك." });
      }

      const rooms = await supabase(
        `chat_rooms?invite_code=eq.${encodeURIComponent(inviteCode)}&select=id`
      );

      const room = rooms?.[0];
      if (!room) {
        return send(res, 404, { error: "رابط الدعوة غير صحيح." });
      }

      const accessToken = newToken();

      const members = await supabase("room_members", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          room_id: room.id,
          display_name: displayName,
          access_token_hash: hashToken(accessToken),
          role: "member",
          status: "pending"
        })
      });

      const member = members?.[0];

      return send(res, 201, {
        ok: true,
        status: "pending",
        message: "تم إرسال طلب الانضمام، انتظر موافقة صاحب الغرفة.",
        roomId: room.id,
        memberId: member?.id,
        accessToken
      });
    }

    // عرض طلبات الانضمام للمالك
    if (req.method === "POST" && pathname === "/api/rooms/requests") {
      const body = await readBody(req);
      const owner = await requireOwner(body.roomId, body.accessToken);

      if (!owner) {
        return send(res, 403, { error: "هذه الصلاحية لصاحب الغرفة فقط." });
      }

      const requests = await supabase(
        `room_members?room_id=eq.${encodeURIComponent(body.roomId)}&status=eq.pending&select=id,display_name,created_at&order=created_at.asc`
      );

      return send(res, 200, { ok: true, requests: requests || [] });
    }

    // قبول أو رفض طلب انضمام
    if (req.method === "POST" && pathname === "/api/rooms/requests/decision") {
      const body = await readBody(req);
      const owner = await requireOwner(body.roomId, body.accessToken);

      if (!owner) {
        return send(res, 403, { error: "هذه الصلاحية لصاحب الغرفة فقط." });
      }

      if (!["approved", "rejected"].includes(body.decision)) {
        return send(res, 400, { error: "قرار غير صحيح." });
      }

      const target = await supabase(
        `room_members?id=eq.${encodeURIComponent(body.memberId)}&room_id=eq.${encodeURIComponent(body.roomId)}&status=eq.pending&select=id`
      );

      if (!target?.length) {
        return send(res, 404, { error: "طلب الانضمام غير موجود." });
      }

      await supabase(
        `room_members?id=eq.${encodeURIComponent(body.memberId)}&room_id=eq.${encodeURIComponent(body.roomId)}&status=eq.pending`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: body.decision })
        }
      );

      return send(res, 200, {
        ok: true,
        status: body.decision
      });
    }

    // جلب رسائل الغرفة
    if (req.method === "GET" && pathname === "/api/rooms/messages") {
      const roomId = url.searchParams.get("roomId");
      const accessToken = url.searchParams.get("accessToken");

      const member = await requireApprovedMember(roomId, accessToken);

      if (!member) {
        return send(res, 403, { error: "انتظر موافقة صاحب الغرفة أولاً." });
      }

      const messages = await supabase(
        `chat_messages?room_id=eq.${encodeURIComponent(roomId)}&select=id,member_id,sender_name,sender_type,content,message_type,audio_path,audio_mime_type,created_at&order=id.asc&limit=100`
      );

      return send(res, 200, { ok: true, messages: messages || [] });
    }

    // استقبال تسجيل صوتي داخل المجموعة وحفظه ثم فهمه بواسطة العطاوي
    if (req.method === "POST" && pathname === "/api/rooms/audio") {
      const body = await readBody(req);
      const roomId = String(body.roomId || "");
      const member = await requireApprovedMember(roomId, body.accessToken);

      if (!member) {
        return send(res, 403, { error: "انتظر موافقة صاحب الغرفة أولاً." });
      }

      if (!API_KEY) {
        return send(res, 500, { error: "Gemini API key missing" });
      }

      const mimeType = String(body.mimeType || "")
        .split(";")[0]
        .trim()
        .toLowerCase();

      if (mimeType !== "audio/wav") {
        return send(res, 400, { error: "يجب إرسال التسجيل بصيغة WAV." });
      }

      const base64Audio = String(body.audioBase64 || "");

      if (!base64Audio || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Audio)) {
        return send(res, 400, { error: "ملف الصوت غير صالح." });
      }

      const audioBuffer = Buffer.from(base64Audio, "base64");

      if (!audioBuffer.length || audioBuffer.length > 14 * 1024 * 1024) {
        return send(res, 400, { error: "حجم التسجيل كبير جداً." });
      }

      const audioPath = `${roomId}/${crypto.randomUUID()}.wav`;

      await uploadRoomAudio(audioPath, audioBuffer, "audio/wav");

      const inserted = await supabase("chat_messages", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          room_id: roomId,
          member_id: member.id,
          sender_name: member.display_name,
          sender_type: "user",
          content: "🎤 رسالة صوتية",
          message_type: "audio",
          audio_path: audioPath,
          audio_mime_type: "audio/wav"
        })
      });

      const historyRows = await supabase(
        `chat_messages?room_id=eq.${encodeURIComponent(roomId)}&select=sender_name,sender_type,content,message_type&order=id.desc&limit=20`
      );

      const history = (historyRows || []).reverse().slice(0, -1);

      const result = await getGeminiAudioReply(
        base64Audio,
        history,
        member.display_name
      );

      const botRows = await supabase("chat_messages", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          room_id: roomId,
          member_id: null,
          sender_name: "رايق ومسبب حرايق",
          sender_type: "assistant",
          content: result.reply,
          message_type: "text"
        })
      });

      return send(res, 200, {
        ok: true,
        userMessage: inserted?.[0] || null,
        assistantMessage: botRows?.[0] || null,
        reply: result.reply,
        model: result.model
      });
    }

    // رابط تشغيل مؤقت للمقطع، لا يحصل عليه إلا عضو مقبول في الغرفة
    if (req.method === "POST" && pathname === "/api/rooms/audio-url") {
      const body = await readBody(req);
      const roomId = String(body.roomId || "");
      const member = await requireApprovedMember(roomId, body.accessToken);

      if (!member) {
        return send(res, 403, { error: "ليس لديك صلاحية تشغيل هذا المقطع." });
      }

      const audioPath = String(body.audioPath || "");

      if (!audioPath.startsWith(roomId + "/") || audioPath.includes("..")) {
        return send(res, 400, { error: "مسار المقطع غير صحيح." });
      }

      const signedUrl = await createRoomAudioUrl(audioPath);

      return send(res, 200, {
        ok: true,
        signedUrl
      });
    }

    // إرسال رسالة نصية داخل الغرفة ورد العطاوي عليها
    if (req.method === "POST" && pathname === "/api/rooms/messages") {
      const body = await readBody(req);
      const roomId = body.roomId;
      const member = await requireApprovedMember(roomId, body.accessToken);

      if (!member) {
        return send(res, 403, { error: "انتظر موافقة صاحب الغرفة أولاً." });
      }

      const content = String(body.content || "").trim();

      if (!content) {
        return send(res, 400, { error: "اكتب رسالتك أولاً." });
      }

      if (content.length > 4000) {
        return send(res, 400, { error: "الرسالة طويلة جداً." });
      }

      const inserted = await supabase("chat_messages", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          room_id: roomId,
          member_id: member.id,
          sender_name: member.display_name,
          sender_type: "user",
          content
        })
      });

      const history = await supabase(
        `chat_messages?room_id=eq.${encodeURIComponent(roomId)}&select=sender_name,sender_type,content&order=id.desc&limit=20`
      );

      const chronologicalHistory = (history || [])
        .reverse()
        .slice(0, -1);

      const result = await getGeminiReply(content, chronologicalHistory);

      const botRows = await supabase("chat_messages", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          room_id: roomId,
          member_id: null,
          sender_name: "العطاوي",
          sender_type: "assistant",
          content: result.reply
        })
      });

      return send(res, 200, {
        ok: true,
        userMessage: inserted?.[0] || null,
        assistantMessage: botRows?.[0] || null,
        reply: result.reply,
        model: result.model
      });
    }

    // استقبال فويس المحادثة الفردية بدون الحاجة إلى غرفة
    if (req.method === "POST" && pathname === "/api/chat/audio") {
      if (!API_KEY) {
        return send(res, 500, { error: "Gemini API key missing" });
      }

      const body = await readBody(req);

      const mimeType = String(body.mimeType || "")
        .split(";")[0]
        .trim()
        .toLowerCase();

      if (mimeType !== "audio/wav") {
        return send(res, 400, { error: "يجب إرسال التسجيل بصيغة WAV." });
      }

      const base64Audio = String(body.audioBase64 || "");

      if (!base64Audio || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Audio)) {
        return send(res, 400, { error: "ملف الصوت غير صالح." });
      }

      const audioBuffer = Buffer.from(base64Audio, "base64");

      if (!audioBuffer.length || audioBuffer.length > 14 * 1024 * 1024) {
        return send(res, 400, { error: "حجم التسجيل كبير جداً." });
      }

      try {
        const result = await getGeminiAudioReply(
          base64Audio,
          [],
          "المستخدم"
        );

        return send(res, 200, {
          ok: true,
          reply: result.reply,
          model: result.model
        });
      } catch (error) {
        console.error("Personal audio error:", error.message);

        return send(res, 503, {
          error: error.message || "تعذر فهم التسجيل الصوتي حالياً."
        });
      }
    }

    // المحادثة القديمة مع Gemini - تبقى شغالة
    if (req.method === "POST" && pathname === "/api/chat") {
      if (!API_KEY) {
        return send(res, 500, { error: "Gemini API key missing" });
      }

      const body = await readBody(req);
      const message = String(body.message || "").trim();

      if (!message) {
        return send(res, 400, { error: "اكتب رسالتك أولاً." });
      }

      if (message.length > 4000) {
        return send(res, 400, { error: "الرسالة طويلة جداً." });
      }

      try {
        const result = await getGeminiReply(message);
        return send(res, 200, result);
      } catch {
        return send(res, 503, {
          error: "النموذجان مشغولان حالياً. حاول بعد قليل."
        });
      }
    }

    return send(res, 404, { error: "Not found" });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return send(res, 500, {
      error: "حدث خطأ في الخادم."
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("MOHAMED AI API running on port " + PORT);
});
