# 🤖 FB Messenger Userbot v2.0.0

بوت Facebook Messenger مبني على `fca-unofficial` مع دعم كامل لرسائل **المحادثات الفردية والجماعية**، لوحة تحكم مباشرة، نظام اقتصاد عملات، قاعدة بيانات SQLite، وأكواد مجدولة (cron).

---

## ⚙️ الإعداد

### 1. إعداد الكوكيز (appstate.json)

**الطريقة الموصى بها:**
1. افتح [messenger.com](https://www.messenger.com) في Chrome
2. اضغط على **أي محادثة** لفتحها (هذا يضيف كوكي `m_sess` الضروري)
3. ثبّت إضافة [Cookie-Editor](https://cookie-editor.com/)
4. اضغط Export → JSON → انسخ الكل
5. الصق المحتوى في ملف `appstate.json` أو عبر لوحة التحكم

### 2. إعداد config.json

انسخ `config.example.json` إلى `config.json` وعدّله:

```json
{
  "botName": "My Bot",
  "prefix": "/",
  "ownerID": "YOUR_FACEBOOK_UID",
  "adminIDs": ["ADMIN_UID"],
  "dashboardPort": 3000,
  "timezone": "Africa/Algiers"
}
```

> **ملاحظة:** `ownerID` هو الـ `c_user` الموجود في الكوكيز.

### 3. تثبيت الحزم

```bash
pnpm --filter @workspace/fb-messenger-bot install
```

### 4. التشغيل

```bash
pnpm --filter @workspace/fb-messenger-bot run dev
```

لوحة التحكم ستكون على: `http://localhost:3000`

---

## 🔑 الفرق بين الكوكيز

| الكوكي | الوصف |
|--------|-------|
| `c_user` | معرّف حسابك |
| `xs` | رمز الجلسة |
| `m_sess` | **ضروري لـ MQTT** (قراءة الرسائل) — يظهر فقط عند فتح محادثة |

---

## 📋 الأوامر

| الأمر | الوصف |
|-------|-------|
| `/help` | قائمة جميع الأوامر |
| `/ping` | زمن الاستجابة |
| `/info` | معلومات البوت |
| `/uid` | معرّف المستخدم والمحادثة |
| `/profile` | بطاقة الملف الشخصي |
| `/balance` | رصيد العملات |
| `/daily` | مكافأة يومية |
| `/givecoin @user amount` | تحويل عملات |
| `/rank` | لوحة المتصدرين |
| `/weather city` | الطقس |
| `/time [city]` | الوقت الحالي |
| `/math expr` | آلة حاسبة |
| `/flip` | قلب العملة |
| `/roll [max]` | رمي النرد |
| `/quiz` | سؤال ثقافي |
| `/say text` | البوت يتكلم (أدمن) |
| `/react emoji` | تفاعل على رسالة (أدمن) |
| `/kick @user` | طرد من الغروب (أدمن) |
| `/add uid` | إضافة لغروب (أدمن) |
| `/ban @user` | حظر مستخدم (أدمن) |
| `/unban @user` | رفع حظر (أدمن) |
| `/unsend` | حذف رسالة البوت (أدمن) |
| `/broadcast msg` | بث لجميع المحادثات (المالك) |

---

## ➕ إضافة أمر جديد

أنشئ ملف `src/commands/yourcommand.js`:

```js
module.exports = {
  config: {
    name: "hello",
    aliases: ["hi"],
    description: "Say hello",
    usage: "hello",
    adminOnly: false,
  },
  async run({ api, event, args, threadID, senderID, isGroup }) {
    api.sendMessage(`Hello! 👋 isGroup: ${isGroup}`, threadID);
  },
};
```

---

## 🗂️ هيكل المشروع

```
fb-messenger-bot/
├── src/
│   ├── index.js          # نقطة الدخول الرئيسية
│   ├── commands/         # جميع الأوامر
│   ├── utils/
│   │   ├── database.js   # SQLite / Sequelize
│   │   ├── loader.js     # تحميل الأوامر تلقائياً
│   │   └── imageGen.js   # توليد الصور
│   └── dashboard/
│       ├── server.js     # Express + Socket.IO
│       └── public/       # واجهة لوحة التحكم
├── config.example.json   # قالب الإعدادات
├── appstate.json         # الكوكيز (لا يُرفع لـ GitHub)
├── config.json           # الإعدادات (لا يُرفع لـ GitHub)
└── data/                 # قاعدة البيانات (لا تُرفع لـ GitHub)
```

---

## ⚠️ تنبيه

- `appstate.json` و `config.json` و `data/` مستثناة من Git لحماية بياناتك.
- لا تشارك ملف الكوكيز مع أحد.
