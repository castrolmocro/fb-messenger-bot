# jarfis Bot v3.0 — WHITE Engine

## المشروع
بوت Facebook Messenger كامل مبني على fca-unofficial مع لوحة تحكم متكاملة.

## التشغيل
```
PORT=5000 npm start
```
لوحة التحكم: http://localhost:5000  
كلمة المرور الافتراضية: `djamel2025*`

## البنية
```
src/
├── index.js              # نقطة الدخول الرئيسية
├── commands/             # أوامر البوت (25+ أمر)
├── dashboard/
│   ├── server.js         # Express API + Socket.IO
│   └── public/index.html # الواجهة (HTML/CSS/JS)
├── protection/
│   ├── stealth.js        # محرك التخفي (UA rotation, browsing)
│   ├── outgoingThrottle.js # تقييد الرسائل
│   ├── humanTyping.js    # محاكاة الكتابة البشرية
│   ├── mqttHealthCheck.js # فحص صحة MQTT
│   ├── keepAlive.js      # نبضة حياة
│   └── rateLimit.js      # تقييد الأوامر
└── utils/
    ├── checkLiveCookie.js  # التحقق من صحة الكوكيز
    ├── getFbstateFromToken.js # تحويل التوكن
    ├── getMsess.js         # جلب m_sess
    ├── database.js         # SQLite/Sequelize
    └── loader.js           # تحميل الأوامر
```

## الكوكيز المطلوبة
- `c_user` — معرّف الحساب ✅ مطلوب
- `xs` — رمز الجلسة ✅ مطلوب
- `m_sess` — جلسة Messenger 🔑 مطلوب للاستماع الفوري
- `datr` — رمز التتبع ✅ موصى به

### كيفية الحصول على m_sess
1. سجّل دخول في `messenger.com` + `facebook.com` في نفس المتصفح
2. صدّر الكوكيز بـ c3c أو Cookie-Editor من **كلا الموقعين**
3. ادمجهما وارفعهما من لوحة التحكم

## أنظمة الحماية (WHITE Engine)
- **Stealth** — تصفح صفحات، تدوير User-Agent، نوم ليلي (1-8 صباحاً)
- **Human Typing** — تأخير كتابة واقعي قبل كل رد
- **Outgoing Throttle** — حد رسائل لكل محادثة وعالمياً
- **MQTT Health Check** — إعادة اتصال تلقائي عند الانقطاع
- **Keep-Alive** — نبضة كل 8-18 دقيقة
- **Rate Limit** — 8 أوامر/10 ثوانٍ لكل مستخدم

## قاعدة البيانات
SQLite — `data/bot.db`
- Users, Threads, CommandLogs

## GitHub
https://github.com/castrolmocro/fb-messenger-bot
