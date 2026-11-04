
const $ = (id) => document.getElementById(id);
const messages = $("messages");

const API = "https://mohamed-ai-api.onrender.com";
let lastReply = "أهلاً! أنا العطاوي.";

// ===================================
// المحادثة النصية
// ===================================

function addMessage(text, who) {
  const el = document.createElement("div");
  el.className = `msg ${who}`;
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

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

// ===================================
// القراءة الصوتية
// ===================================

function speakText(text, onFinish) {
  if (!("speechSynthesis" in window)) {
    if (onFinish) onFinish();
    return;
  }

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ar-SA";
  utterance.rate = 1;
  utterance.pitch = 1;

  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (onFinish) onFinish();
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  speechSynthesis.speak(utterance);
}

$("speakBtn").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    return alert("القراءة الصوتية غير مدعومة.");
  }

  speakText(lastReply);
});

// ===================================
// الإملاء الصوتي
// ===================================

$("micBtn").addEventListener("click", () => {
  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) {
    return alert("الإملاء الصوتي غير مدعوم في هذا المتصفح.");
  }

  const recognition = new Recognition();
  recognition.lang = "ar-SA";

  recognition.onresult = (event) => {
    $("prompt").value = event.results[0][0].transcript;
  };

  recognition.onerror = (event) => {
    alert("مشكلة في المايك: " + event.error);
  };

  recognition.start();
});

// ===================================
// تحويل مفتاح Web Push
// ===================================

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = atob(base64);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

// ===================================
// الإشعارات
// ===================================

$("notifyBtn").addEventListener("click", async () => {
  try {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      return alert("الإشعارات غير مدعومة في هذا المتصفح.");
    }

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInstalled =
      window.navigator.standalone ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (isIOS && !isInstalled) {
      return alert(
        "افتح الموقع من Safari ثم اختر مشاركة ← إضافة إلى الشاشة الرئيسية."
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

    alert("تم تفعيل الإشعارات بنجاح ❤️");

  } catch (error) {
    console.error(error);
    alert("تعذر تفعيل الإشعارات: " + error.message);
  }
});

// ===================================
// التذكيرات
// ===================================

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

      if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const registration = await navigator.serviceWorker.ready;

        registration.showNotification("تذكير من العطاوي", {
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

// ===================================
// Service Worker
// ===================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

// ===================================
// مكالمة العطاوي - نظام استماع جديد
// ===================================

let voiceCallActive = false;
let voiceRecognition = null;
let voiceBusy = false;
let voiceStarting = false;
let callMuted = false;

let callStartedAt = 0;
let callTimerInterval = null;
let listenTimeout = null;
let callSession = 0;

function updateCallButtons(active) {
  const screen = $("callScreen");
  const app = $("mainApp");

  if (screen) screen.hidden = !active;
  if (app) app.hidden = active;

  document.body.classList.toggle("in-call", active);
}

function setCallSubtitle(text) {
  if ($("callSubtitle")) {
    $("callSubtitle").textContent = text;
  }
}

function updateCallTimer() {
  if (!callStartedAt) return;

  const elapsed = Math.floor((Date.now() - callStartedAt) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  if ($("callTimer")) {
    $("callTimer").textContent = `${minutes}:${seconds}`;
  }
}

// ===================================
// كتم وإلغاء كتم المايك
// ===================================

function setMuted(muted) {
  callMuted = muted;

  if ($("muteIcon")) {
    $("muteIcon").textContent = muted ? "🔇" : "🎙️";
  }

  if ($("muteText")) {
    $("muteText").textContent = muted ? "إلغاء الكتم" : "كتم الصوت";
  }

  if ($("muteCallBtn")) {
    $("muteCallBtn").classList.toggle("muted", muted);
  }

  if (muted) {
    setCallSubtitle("الميكروفون مكتوم");

    clearTimeout(listenTimeout);

    if (voiceRecognition) {
      const old = voiceRecognition;
      voiceRecognition = null;

      try {
        old.stop();
      } catch (error) {
        console.log(error);
      }
    }
  } else {
    setCallSubtitle("يسمعك الآن...");
    startListeningAgain();
  }
}

// ===================================
// بدء المكالمة
// ===================================

function startAlAtawiCall() {
  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) {
    alert("التعرف على الصوت غير مدعوم. جرّب Safari أو Chrome.");
    return;
  }

  if (!window.isSecureContext) {
    alert("افتح العطاوي عبر رابط HTTPS.");
    return;
  }

  if (voiceCallActive) return;

  callSession++;
  voiceCallActive = true;
  voiceBusy = false;
  voiceStarting = false;
  callMuted = false;

  callStartedAt = Date.now();

  updateCallTimer();

  clearInterval(callTimerInterval);
  callTimerInterval = setInterval(updateCallTimer, 1000);

  if ($("callStatus")) {
    $("callStatus").textContent = "متصل";
  }

  updateCallButtons(true);
  setCallSubtitle("يسمعك الآن...");

  if ($("muteIcon")) $("muteIcon").textContent = "🎙️";
  if ($("muteText")) $("muteText").textContent = "كتم الصوت";

  startListeningAgain();
}

// ===================================
// إنشاء جلسة استماع جديدة لكل جملة
// ===================================

function startListeningAgain() {
  if (
    !voiceCallActive ||
    voiceBusy ||
    voiceStarting ||
    callMuted
  ) {
    return;
  }

  clearTimeout(listenTimeout);

  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) return;

  voiceStarting = true;

  // إنشاء كائن جديد بدلاً من إعادة استخدام الجلسة القديمة
  const recognition = new Recognition();

  voiceRecognition = recognition;

  recognition.lang = "ar-SA";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let receivedResult = false;
  let handled = false;

  recognition.onstart = () => {
    voiceStarting = false;

    if (voiceCallActive && !callMuted && !voiceBusy) {
      setCallSubtitle("يسمعك الآن...");
    }
  };

  recognition.onresult = async (event) => {
    if (handled) return;
    handled = true;
    receivedResult = true;

    if (!voiceCallActive || callMuted) return;

    const message = event.results?.[0]?.[0]?.transcript?.trim();

    if (!message) {
      voiceBusy = false;
      scheduleListening(800);
      return;
    }

    voiceBusy = true;
    setCallSubtitle("لحظة، أفكر...");

    // إيقاف جلسة الاستماع الحالية
    try {
      recognition.stop();
    } catch (error) {
      console.log(error);
    }

    addMessage(message, "user");

    const thisSession = callSession;

    try {
      const response = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "فشل الاتصال بالخادم.");
      }

      if (!voiceCallActive || thisSession !== callSession) return;

      lastReply = data.reply || "ما قدرت أجهز الرد.";

      addMessage(lastReply, "assistant");

      if (callMuted) {
        voiceBusy = false;
        return;
      }

      setCallSubtitle("العطاوي يتحدث...");

      if ($("avatarRing")) {
        $("avatarRing").classList.add("speaking");
      }

      // تشغيل صوت الرد ثم إعادة الاستماع
      speakText(lastReply, () => {
        if ($("avatarRing")) {
          $("avatarRing").classList.remove("speaking");
        }

        if (!voiceCallActive || thisSession !== callSession) return;

        voiceBusy = false;

        if (!callMuted) {
          setCallSubtitle("يسمعك الآن...");
          scheduleListening(900);
        }
      });

    } catch (error) {
      console.error("خطأ المكالمة:", error);

      if (!voiceCallActive || thisSession !== callSession) return;

      voiceBusy = false;

      addMessage("تعذر الاتصال بالعطاوي: " + error.message, "assistant");

      if (!callMuted) {
        setCallSubtitle("يسمعك الآن...");
        scheduleListening(1200);
      }
    }
  };

  recognition.onerror = (event) => {
    console.error("خطأ التعرف الصوتي:", event.error);

    voiceStarting = false;

    if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed"
    ) {
      alert("اسمح للمتصفح باستخدام المايك من إعدادات الموقع.");
      stopAlAtawiCall();
      return;
    }

    if (
      event.error === "aborted" ||
      event.error === "no-speech"
    ) {
      if (voiceCallActive && !voiceBusy && !callMuted) {
        scheduleListening(1000);
      }
      return;
    }

    if (voiceCallActive && !voiceBusy && !callMuted) {
      scheduleListening(1500);
    }
  };

  recognition.onend = () => {
    voiceStarting = false;

    // إذا لم تصل جملة، نبدأ جلسة جديدة
    if (
      !receivedResult &&
      voiceCallActive &&
      !voiceBusy &&
      !callMuted
    ) {
      scheduleListening(900);
    }
  };

  try {
    recognition.start();
  } catch (error) {
    voiceStarting = false;
    console.error("تعذر بدء الاستماع:", error);

    scheduleListening(1500);
  }
}

// ===================================
// إعادة الاستماع بتوقيت منظم
// ===================================

function scheduleListening(delay = 800) {
  clearTimeout(listenTimeout);

  if (!voiceCallActive || callMuted || voiceBusy) return;

  listenTimeout = setTimeout(() => {
    if (
      voiceCallActive &&
      !callMuted &&
      !voiceBusy &&
      !voiceStarting
    ) {
      startListeningAgain();
    }
  }, delay);
}

// ===================================
// إنهاء المكالمة
// ===================================

function stopAlAtawiCall() {
  callSession++;

  voiceCallActive = false;
  voiceBusy = false;
  voiceStarting = false;
  callMuted = false;

  clearTimeout(listenTimeout);
  clearInterval(callTimerInterval);

  callTimerInterval = null;
  callStartedAt = 0;

  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }

  if (voiceRecognition) {
    const oldRecognition = voiceRecognition;
    voiceRecognition = null;

    oldRecognition.onend = null;
    oldRecognition.onerror = null;
    oldRecognition.onresult = null;
    oldRecognition.onstart = null;

    try {
      oldRecognition.abort();
    } catch (error) {
      console.log(error);
    }
  }

  if ($("callTimer")) {
    $("callTimer").textContent = "00:00";
  }

  if ($("avatarRing")) {
    $("avatarRing").classList.remove("speaking");
  }

  if ($("muteIcon")) $("muteIcon").textContent = "🎙️";
  if ($("muteText")) $("muteText").textContent = "كتم الصوت";

  if ($("muteCallBtn")) {
    $("muteCallBtn").classList.remove("muted");
  }

  if ($("callStatus")) {
    $("callStatus").textContent = "انتهت المكالمة";
  }

  updateCallButtons(false);

  console.log("انتهت مكالمة العطاوي.");
}

// ===================================
// ربط أزرار المكالمة
// ===================================

if ($("voiceCallBtn")) {
  $("voiceCallBtn").addEventListener("click", startAlAtawiCall);
}

if ($("endCallBtn")) {
  $("endCallBtn").addEventListener("click", stopAlAtawiCall);
}

if ($("muteCallBtn")) {
  $("muteCallBtn").addEventListener("click", () => {
    setMuted(!callMuted);
  });
}
