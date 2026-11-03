const $ = (id) => document.getElementById(id);
const messages = $("messages");

const API = "https://mohamed-ai-api.onrender.com";

let lastReply = "أهلاً! أنا MOHAMED AI.";

function addMessage(text, who) {
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

// المحادثة مع Gemini
$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const value = $("prompt").value.trim();
  if (!value) return;

  addMessage(value, "user");
  $("prompt").value = "";

  try {
    const response = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: value })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error);

    lastReply = data.reply || "ما وصلني رد واضح.";
  } catch (error) {
    lastReply = "سبب المشكلة: " + error.message;
  }

  addMessage(lastReply, "assistant");
});

// القراءة الصوتية
$("speakBtn").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    return alert("ميزة القراءة الصوتية غير مدعومة.");
  }

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(lastReply);
  utterance.lang = "ar-SA";
  speechSynthesis.speak(utterance);
});

// الإملاء الصوتي
$("micBtn").addEventListener("click", () => {
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!Recognition) {
    return alert("الإملاء الصوتي غير مدعوم في هذا المتصفح.");
  }

  const recognition = new Recognition();
  recognition.lang = "ar-SA";

  recognition.onresult = (event) => {
    $("prompt").value = event.results[0][0].transcript;
  };

  recognition.onerror = () => alert("تأكد من إذن المايك.");
  recognition.start();
});

// تحويل المفتاح العام إلى صيغة Web Push
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = atob(base64);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

// تفعيل الإشعارات وربط الاشتراك بالخادم
$("notifyBtn").addEventListener("click", async () => {
  try {
    if (!("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)) {
      return alert("الإشعارات غير مدعومة في هذا المتصفح.");
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInstalled =
      window.navigator.standalone ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (isIOS && !isInstalled) {
      return alert(
        "افتح الموقع من Safari، ثم اختر مشاركة ← إضافة إلى الشاشة الرئيسية، وبعدها افتح التطبيق من الأيقونة."
      );
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      return alert("لم تسمح بالإشعارات.");
    }

    const registration = await navigator.serviceWorker.ready;

    const keyResponse = await fetch(`${API}/api/push/public-key`);
    const keyData = await keyResponse.json();

    if (!keyResponse.ok || !keyData.publicKey) {
      throw new Error("تعذر الحصول على مفتاح الإشعارات.");
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });
    }

    const saveResponse = await fetch(`${API}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription })
    });

    const saveData = await saveResponse.json();

    if (!saveResponse.ok) {
      throw new Error(saveData.error || "تعذر حفظ الاشتراك.");
    }

    alert("تم تفعيل الإشعارات وربط جهازك بنجاح! ❤️");

  } catch (error) {
    console.error(error);
    alert("تعذر تفعيل الإشعارات: " + error.message);
  }
});

// نظام التذكيرات الحالي
const STORAGE = "mohamed-ai-reminders-v1";

let reminders = JSON.parse(localStorage.getItem(STORAGE) || "[]");

function saveReminders() {
  localStorage.setItem(STORAGE, JSON.stringify(reminders));
  renderReminders();
}

function renderReminders() {
  const root = $("reminderList");
  root.replaceChildren();

  reminders.sort((a, b) => new Date(a.time) - new Date(b.time));

  reminders.forEach(item => {
    const row = document.createElement("div");
    row.className = "reminder";

    const info = document.createElement("div");
    info.textContent = item.text;

    const date = document.createElement("small");
    date.textContent = new Date(item.time).toLocaleString("ar-SA");

    info.appendChild(date);

    const del = document.createElement("button");
    del.className = "remove";
    del.textContent = "×";
    del.setAttribute("aria-label", "حذف التذكير");

    del.onclick = () => {
      reminders = reminders.filter(x => x.id !== item.id);
      saveReminders();
    };

    row.append(info, del);
    root.appendChild(row);
  });
}

$("reminderForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const text = $("reminderText").value.trim();
  const time = $("reminderTime").value;

  if (!text || !time) return;

  reminders.push({
    id: crypto.randomUUID(),
    text,
    time,
    notified: false
  });

  $("reminderText").value = "";
  saveReminders();
});

async function checkReminders() {
  const now = Date.now();
  let changed = false;

  for (const item of reminders) {
    if (!item.notified && new Date(item.time).getTime() <= now) {
      item.notified = true;
      changed = true;

      if ("Notification" in window &&
          Notification.permission === "granted") {
        const registration = await navigator.serviceWorker.ready;

        registration.showNotification("تذكير من MOHAMED AI", {
          body: item.text,
          icon: "./icon.svg"
        });
      } else {
        alert("تذكير: " + item.text);
      }
    }
  }

  if (changed) saveReminders();
}

renderReminders();

setInterval(checkReminders, 15000);
checkReminders();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}
