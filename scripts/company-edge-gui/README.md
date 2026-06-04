# مشغّل جهاز الشركة — واجهة رسومية / EXE

تطبيق Windows يشغّل **IP Camera Viewer** على PC داخل الشركة (كاميرات RTSP محلية + واجهة ويب + WebSocket + AI).

## التشغيل بدون بناء EXE

```bat
scripts\company-edge-gui\run-gui.bat
```

أو:

```bat
python scripts\company-edge-gui\app.py
```

## بناء ملف EXE

على **Windows** (مرة واحدة):

```bat
cd /d "C:\Users\...\Desktop\ip-cam-viewer-main"
scripts\company-edge-gui\build-windows.bat
```

**مهم:** شغّل الملف بالنقر المزدوج أو من CMD — لا تلصق محتوى الملف في سطر الأوامر.

الناتج: `dist-launcher\CompanyEdgeLauncher.exe`

**مهم:** انسخ `CompanyEdgeLauncher.exe` إلى **جذر المشروع** (نفس مجلد `package.json`) ثم شغّله.

## ماذا تفعل الواجهة؟

| زر | الوظيفة |
|----|---------|
| **إعداد أولي** | `npm install`، بناء الواجهة، go2rtc، قاعدة البيانات |
| **تشغيل السيرفر** | يشغّل Node على المنفذ 3000 (UI+API+WS+go2rtc) |
| **اكتشاف وربط الكاميرات** | ربط تلقائي لكل الكاميرات |
| **معالج الكاميرات** (في الواجهة) | ① مسح ② اختبار دخول ③ بث + WebSocket real-time |
| **إيقاف** | يوقف العملية |
| **فتح المتصفح** | `http://IP-الجهاز:3000` |

بعد **تشغيل السيرفر**، إذا كان `EDGE_AUTO_PROVISION=true` في `.env` يُنفَّذ الاكتشاف والربط تلقائياً.

### إعداد كلمات مرور الكاميرات

في `.env` (انسخ من `.env.company-edge.example`):

```env
EDGE_CAMERA_USERNAME=admin
EDGE_CAMERA_PASSWORD=admin123
EDGE_API_USERNAME=admin
EDGE_API_PASSWORD=admin123
```

الهوست (أي PC على VPN أو الشبكة) يفتح `http://IP-جهاز-الشركة:3000` — نفس الواجهة و`/api/streams/…` للبث (HLS/WebRTC)، دون فتح RTSP للإنترنت.

### معالج الكاميرات (خطوة بخطوة)

1. **▶ تشغيل السيرفر**
2. أدخل **مستخدم/كلمة مرور الكاميرا** و **API** في المعالج
3. **① مسح الشبكة** — اكتشاف ONVIF
4. اختر كاميراً → **② اختبار الاتصال** — تسجيل دخول والتحقق
5. **③ إضافة وبدء البث** — RTSP → go2rtc → API + `Socket.IO` + `ws://…/go2rtc/api/ws`

```bat
pip install -r scripts\company-edge-gui\requirements.txt
```

## المتطلبات على جهاز الشركة

- Windows 10/11
- [Node.js LTS](https://nodejs.org/)
- FFmpeg في PATH (للتسجيل)
- Python + `.venv` (اختياري — للتعرف على الوجوه): `scripts\setup-face-python.bat`

## الشبكة

- الكاميرات: `192.168.x.x` — يجب أن يراها **نفس الجهاز** الذي يشغّل المشغّل.
- من خارج المكتب: VPN فقط — لا تفتح RTSP على الإنترنت.
