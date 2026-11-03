ملفات خادم MOHAMED AI

ارفع server.js و package.json إلى جذر مستودع GitHub نفسه، بجانب index.html.

إعداد Render:
- Language: Node
- Branch: main
- Root Directory: اتركه فارغاً
- Build Command: npm install
- Start Command: npm start
- Compute: Free

Environment Variables في Render:
- OPENAI_API_KEY = مفتاح API (الصقه داخل Render فقط، ولا ترفعه إلى GitHub)
- SITE_ORIGIN = أصل موقع GitHub Pages، مثال: https://hacker51145.github.io
- OPENAI_MODEL = gpt-4.1-mini (اختياري)

بعد النشر انسخ رابط Render من نوع https://اسم-الخدمة.onrender.com.
ثم في ملف app.js بموقع GitHub غيّر السطر:
const API_BASE = "https://YOUR-RENDER-SERVICE.onrender.com";
إلى رابط خدمتك الحقيقي، واستبدل fetch("/api/chat" بـ fetch(`${API_BASE}/api/chat`.
لا تشارك مفتاح API في المحادثات أو GitHub.
