const $ = (id) => document.getElementById(id);
const messages = $("messages");
let lastReply = "حالياً أقدر أستقبل رسالتك من الواجهة. بعد ربط خادم الذكاء الاصطناعي سأقدر أرد عليك بشكل ذكي.";

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
  // نقطة الربط بالخادم: أنشئ /api/chat لاحقاً وضعه على نفس النطاق.
  try {
    const response = await fetch("https://mohamed-ai-api.onrender.com/api/chat", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({message:value})
    });
    const data = await response.json();

if (!response.ok) {
  throw new Error(data.error || "خطأ في الخادم");
}

lastReply = data.reply || "ما وصلني رد واضح.";

} catch (error) {
  lastReply = "سبب المشكلة: " + error.message;
}
  addMessage(lastReply, "assistant");
});
$("speakBtn").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) return alert("ميزة القراءة الصوتية غير مدعومة في هذا المتصفح.");
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(lastReply);
  utterance.lang = "ar-SA";
  speechSynthesis.speak(utterance);
});
$("micBtn").addEventListener("click", () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return alert("الإملاء الصوتي غير مدعوم هنا. جرّب Chrome على الجوال.");
  const recognition = new Recognition();
  recognition.lang = "ar-SA";
  recognition.onresult = (event) => { $("prompt").value = event.results[0][0].transcript; };
  recognition.onerror = () => alert("ما قدرت أسمعك. تأكد من إذن المايك.");
  recognition.start();
});
$("notifyBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) return alert("المتصفح لا يدعم الإشعارات.");
  const permission = await Notification.requestPermission();
  alert(permission === "granted" ? "تم السماح بالإشعارات من المتصفح." : "لم يتم السماح بالإشعارات.");
});

const STORAGE = "mohamed-ai-reminders-v1";
let reminders = JSON.parse(localStorage.getItem(STORAGE) || "[]");
function saveReminders(){ localStorage.setItem(STORAGE, JSON.stringify(reminders)); renderReminders(); }
function renderReminders(){
  const root = $("reminderList"); root.replaceChildren();
  reminders.sort((a,b)=>new Date(a.time)-new Date(b.time)).forEach(item=>{
    const row=document.createElement("div"); row.className="reminder";
    const info=document.createElement("div"); info.textContent=item.text;
    const date=document.createElement("small"); date.textContent=new Date(item.time).toLocaleString("ar-SA");
    info.appendChild(date);
    const del=document.createElement("button"); del.className="remove"; del.textContent="×"; del.setAttribute("aria-label","حذف التذكير");
    del.onclick=()=>{reminders=reminders.filter(x=>x.id!==item.id);saveReminders();};
    row.append(info,del);root.appendChild(row);
  });
}
$("reminderForm").addEventListener("submit",(e)=>{
  e.preventDefault();
  const text=$("reminderText").value.trim(), time=$("reminderTime").value;
  if(!text||!time)return;
  reminders.push({id:crypto.randomUUID(),text,time,notified:false});
  $("reminderText").value="";saveReminders();
});
async function checkReminders(){
  const now=Date.now(); let changed=false;
  for(const item of reminders){
    if(!item.notified && new Date(item.time).getTime()<=now){
      item.notified=true;changed=true;
      if("Notification" in window && Notification.permission==="granted"){
        if("serviceWorker" in navigator && navigator.serviceWorker.controller){
          navigator.serviceWorker.ready.then(reg=>reg.showNotification("تذكير من MOHAMED AI",{body:item.text,icon:"icon.svg"}));
        } else new Notification("تذكير من MOHAMED AI",{body:item.text});
      } else alert("تذكير: "+item.text);
    }
  }
  if(changed)saveReminders();
}
renderReminders(); setInterval(checkReminders,15000); checkReminders();
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
