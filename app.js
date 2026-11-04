
const $ = (id) => document.getElementById(id);
const API = "https://mohamed-ai-api.onrender.com";
const STORAGE = "mohamed-ai-room-v1";

let lastReply = "أهلاً! أنا العطاوي.";
let room = JSON.parse(localStorage.getItem(STORAGE) || "null");
let lastMessageId = 0;
let roomPolling = null;
let requestPolling = null;
let pendingJoin = false;

const messages = $("messages");

// ===================================
// أدوات عامة
// ===================================

async function api(path, options = {}) {
  const response = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "حدث خطأ في الاتصال.");
  }

  return data;
}

function post(path, body) {
  return api(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function saveRoom() {
  if (room) {
    localStorage.setItem(STORAGE, JSON.stringify(room));
  } else {
    localStorage.removeItem(STORAGE);
  }
}

function showModal(id) {
  $(id).hidden = false;
}

function hideModal(id) {
  $(id).hidden = true;
}

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    hideModal(button.dataset.close);
  });
});

// ===================================
// عرض الرسائل
// ===================================

function addMessage(text, who, senderName = "") {
  const el = document.createElement("div");
  el.className = `msg ${who}`;

  if (senderName) {
    const name = document.createElement("strong");
    name.className = "sender-name";
    name.textContent = senderName;
    el.appendChild(name);
  }

  const content = document.createElement("div");
  content.textContent = text;
  el.appendChild(content);

  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function addRoomMessage(item) {
  if (!item || !item.id || item.id <= lastMessageId) return;

  lastMessageId = item.id;

  const who = item.sender_type === "assistant" ? "assistant" : "user";

  addMessage(
    item.content,
    who,
    item.sender_name
  );

  if (item.sender_type === "assistant") {
    lastReply = item.content;
  }
}

function renderRoomInfo(text) {
  const info = $("roomInfo");
  info.hidden = !text;
  info.textContent = text || "";
}

function clearMessages() {
  messages.replaceChildren();
  lastMessageId = 0;
}

// ===================================
// إنشاء غرفة ودعوة صديق
// ===================================

$("addFriendBtn").addEventListener("click", () => {
  if (room?.role === "owner") {
    showModal("createRoomModal");
    $("inviteResult").hidden = false;
    return;
  }

  if (room) {
    alert("أنت داخل غرفة بالفعل على هذا الجهاز.");
    return;
  }

  showModal("createRoomModal");
});

$("createRoomBtn").addEventListener("click", async () => {
  const ownerName = $("ownerName").value.trim();

  if (!ownerName) {
    alert("اكتب اسمك أولاً.");
    return;
  }

  const button = $("createRoomBtn");
  button.disabled = true;
  button.textContent = "جاري إنشاء الغرفة...";

  try {
    const data = await post("/api/rooms/create", {
      ownerName
    });

    room = {
      roomId: data.roomId,
      accessToken: data.accessToken,
      memberId: data.memberId,
      role: "owner",
      displayName: ownerName
    };

    saveRoom();

    const inviteUrl = new URL(window.location.href);
    inviteUrl.search = "";
    inviteUrl.hash = "";
    inviteUrl.searchParams.set("invite", data.inviteCode);

    $("inviteLink").value = inviteUrl.toString();
    $("inviteResult").hidden = false;

    button.textContent = "تم إنشاء الغرفة";

    await activateRoom();
    alert("تم إنشاء الغرفة بنجاح. انسخ الرابط وأرسله لصديقك.");

  } catch (error) {
    alert(error.message);
    button.textContent = "إنشاء رابط الدعوة";
  } finally {
    button.disabled = false;
  }
});

$("copyInviteBtn").addEventListener("click", async () => {
  const link = $("inviteLink").value;

  try {
    await navigator.clipboard.writeText(link);
    alert("تم نسخ رابط الدعوة ❤️");
  } catch {
    $("inviteLink").select();
    document.execCommand("copy");
    alert("تم نسخ الرابط.");
  }
});

// ===================================
// استقبال رابط دعوة
// ===================================

const inviteCode = new URLSearchParams(location.search).get("invite");

if (inviteCode && !room) {
  showModal("joinRoomModal");
}

$("joinRoomBtn").addEventListener("click", async () => {
  const displayName = $("joinName").value.trim();

  if (!displayName) {
    alert("اكتب اسمك أولاً.");
    return;
  }

  const button = $("joinRoomBtn");
  button.disabled = true;
  button.textContent = "جاري إرسال الطلب...";

  try {
    const data = await post("/api/rooms/join", {
      inviteCode,
      displayName
    });

    room = {
      roomId: data.roomId,
      accessToken: data.accessToken,
      memberId: data.memberId,
      role: "member",
      displayName
    };

    pendingJoin = true;
    saveRoom();

    $("joinStatus").textContent =
      "تم إرسال طلبك. انتظر موافقة صاحب الغرفة.";

    button.textContent = "تم إرسال الطلب";

    history.replaceState({}, "", location.pathname);

    await activateRoom();

  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = "إرسال طلب الانضمام";
  }
});

// ===================================
// تشغيل الغرفة
// ===================================

async function activateRoom() {
  if (!room) return;

  clearInterval(roomPolling);
  clearInterval(requestPolling);

  if (room.role === "owner") {
    renderRoomInfo("غرفتك الخاصة · أنت صاحب الغرفة");
    hideModal("createRoomModal");
  } else {
    renderRoomInfo(
      pendingJoin
        ? "طلب الانضمام قيد الانتظار..."
        : "غرفة مشتركة مع صديقك"
    );
  }

  clearMessages();

  if (room.role === "owner") {
    addMessage(
      "تم إنشاء الغرفة. أرسل رابط الدعوة لصديقك، وسيظهر طلبه هنا.",
      "assistant"
    );
  }

  await loadRoomMessages();

  roomPolling = setInterval(loadRoomMessages, 3000);

  if (room.role === "owner") {
    await loadRequests();
    requestPolling = setInterval(loadRequests, 6000);
  }
}

// ===================================
// تحميل رسائل الغرفة
// ===================================

async function loadRoomMessages() {
  if (!room) return;

  try {
    const query = new URLSearchParams({
      roomId: room.roomId,
      accessToken: room.accessToken
    });

    const data = await api(
      "/api/rooms/messages?" + query.toString()
    );

    if (pendingJoin) {
      pendingJoin = false;
      renderRoomInfo("تم قبولك! أنت الآن داخل المحادثة المشتركة ❤️");
      hideModal("joinRoomModal");
      clearMessages();
    }

    for (const item of data.messages || []) {
      addRoomMessage(item);
    }

  } catch (error) {
    if (pendingJoin) {
      $("joinStatus").textContent =
        "بانتظار موافقة صاحب الغرفة...";
      return;
    }

    console.error("تعذر تحميل رسائل الغرفة:", error);
  }
}

// ===================================
// طلبات الانضمام
// ===================================

$("requestsBtn").addEventListener("click", async () => {
  if (!room || room.role !== "owner") {
    alert("طلبات الانضمام تظهر لصاحب الغرفة فقط.");
    return;
  }

  showModal("requestsModal");
  await loadRequests();
});

async function loadRequests() {
  if (!room || room.role !== "owner") return;

  try {
    const data = await post("/api/rooms/requests", {
      roomId: room.roomId,
      accessToken: room.accessToken
    });

    const list = $("requestsList");
    const badge = $("requestBadge");

    list.replaceChildren();

    const requests = data.requests || [];

    badge.hidden = requests.length === 0;
    badge.textContent = requests.length;

    if (!requests.length) {
      const empty = document.createElement("p");
      empty.textContent = "لا توجد طلبات حالياً.";
      list.appendChild(empty);
      return;
    }

    requests.forEach(request => {
      const row = document.createElement("div");
      row.className = "request-item";

      const name = document.createElement("strong");
      name.textContent = request.display_name;

      const actions = document.createElement("div");
      actions.className = "request-actions";

      const accept = document.createElement("button");
      accept.textContent = "قبول";
      accept.className = "accept-btn";

      accept.addEventListener("click", () => {
        decideRequest(request.id, "approved");
      });

      const reject = document.createElement("button");
      reject.textContent = "رفض";
      reject.className = "reject-btn";

      reject.addEventListener("click", () => {
        decideRequest(request.id, "rejected");
      });

      actions.append(accept, reject);
      row.append(name, actions);
      list.appendChild(row);
    });

  } catch (error) {
    console.error("طلبات الانضمام:", error);
  }
}

async function decideRequest(memberId, decision) {
  try {
    await post("/api/rooms/requests/decision", {
      roomId: room.roomId,
      accessToken: room.accessToken,
      memberId,
      decision
    });

    await loadRequests();

    alert(
      decision === "approved"
        ? "تم قبول طلب الانضمام."
        : "تم رفض طلب الانضمام."
    );

  } catch (error) {
    alert(error.message);
  }
}

// ===================================
// إرسال الرسائل
// ===================================

$("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const value = $("prompt").value.trim();
  if (!value) return;

  $("prompt").value = "";

  if (room && pendingJoin) {
    alert("انتظر موافقة صاحب الغرفة أولاً.");
    return;
  }

  if (room) {
    try {
      await post("/api/rooms/messages", {
        roomId: room.roomId,
        accessToken: room.accessToken,
        content: value
      });

      await loadRoomMessages();

    } catch (error) {
      addMessage("تعذر إرسال الرسالة: " + error.message, "assistant");
    }

    return;
  }

  addMessage(value, "user");

  try {
    const data = await post("/api/chat", {
      message: value
    });

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

  return Uint8Array.from(
    raw,
    char => char.charCodeAt(0)
  );
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

    const keyData = await api("/api/push/public-key");

    let subscription =
      await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
      });
    }

    await post("/api/push/subscribe", { subscription });

    alert("تم تفعيل الإشعارات بنجاح ❤️");

  } catch (error) {
    console.error(error);
    alert("تعذر تفعيل الإشعارات: " + error.message);
  }
});

// ===================================
// Service Worker
// ===================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}

// ===================================
// المكالمة الصوتية
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
  $("callScreen").hidden = !active;
  $("mainApp").hidden = active;
  document.body.classList.toggle("in-call", active);
}

function setCallSubtitle(text) {
  $("callSubtitle").textContent = text;
}

function updateCallTimer() {
  if (!callStartedAt) return;

  const elapsed = Math.floor((Date.now() - callStartedAt) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");

  $("callTimer").textContent = `${minutes}:${seconds}`;
}

function setMuted(muted) {
  callMuted = muted;

  $("muteIcon").textContent = muted ? "🔇" : "🎙️";
  $("muteText").textContent = muted ? "إلغاء الكتم" : "كتم الصوت";
  $("muteCallBtn").classList.toggle("muted", muted);

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

  $("callStatus").textContent = "متصل";

  updateCallButtons(true);
  setCallSubtitle("يسمعك الآن...");

  $("muteIcon").textContent = "🎙️";
  $("muteText").textContent = "كتم الصوت";

  startListeningAgain();
}

function startListeningAgain() {
  if (
    !voiceCallActive ||
    voiceBusy ||
    voiceStarting ||
    callMuted
  ) return;

  clearTimeout(listenTimeout);

  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) return;

  voiceStarting = true;

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

    try {
      recognition.stop();
    } catch (error) {
      console.log(error);
    }

    addMessage(message, "user");

    const thisSession = callSession;

    try {
      let data;

      if (room && !pendingJoin) {
        data = await post("/api/rooms/messages", {
          roomId: room.roomId,
          accessToken: room.accessToken,
          content: message
        });
      } else if (room && pendingJoin) {
        throw new Error("انتظر موافقة صاحب الغرفة.");
      } else {
        data = await post("/api/chat", { message });
      }

      if (!voiceCallActive || thisSession !== callSession) return;

      lastReply = data.reply || "ما قدرت أجهز الرد.";

      if (room) {
        await loadRoomMessages();
      } else {
        addMessage(lastReply, "assistant");
      }

      if (callMuted) {
        voiceBusy = false;
        return;
      }

      setCallSubtitle("العطاوي يتحدث...");
      $("avatarRing").classList.add("speaking");

      speakText(lastReply, () => {
        $("avatarRing").classList.remove("speaking");

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
    const old = voiceRecognition;
    voiceRecognition = null;

    old.onend = null;
    old.onerror = null;
    old.onresult = null;
    old.onstart = null;

    try {
      old.abort();
    } catch (error) {
      console.log(error);
    }
  }

  $("callTimer").textContent = "00:00";
  $("avatarRing").classList.remove("speaking");
  $("muteIcon").textContent = "🎙️";
  $("muteText").textContent = "كتم الصوت";
  $("muteCallBtn").classList.remove("muted");
  $("callStatus").textContent = "انتهت المكالمة";

  updateCallButtons(false);
}

$("voiceCallBtn").addEventListener("click", startAlAtawiCall);
$("endCallBtn").addEventListener("click", stopAlAtawiCall);

$("muteCallBtn").addEventListener("click", () => {
  setMuted(!callMuted);
});

// ===================================
// استعادة الغرفة عند فتح التطبيق
// ===================================

if (room?.roomId && room?.accessToken) {
  activateRoom();
}
