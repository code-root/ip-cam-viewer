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
scripts\company-edge-gui\build-windows.bat
```

الناتج: `dist-launcher\CompanyEdgeLauncher.exe`

**مهم:** انسخ `CompanyEdgeLauncher.exe` إلى **جذر المشروع** (نفس مجلد `package.json`) ثم شغّله.

## ماذا تفعل الواجهة؟

| زر | الوظيفة |
|----|---------|
| **إعداد أولي** | `npm install`، بناء الواجهة، go2rtc، قاعدة البيانات |
| **تشغيل السيرفر** | يشغّل Node على المنفذ 3000 (UI+API+WS) |
| **إيقاف** | يوقف العملية |
| **فتح المتصفح** | `http://IP-الجهاز:3000` |

## المتطلبات على جهاز الشركة

- Windows 10/11
- [Node.js LTS](https://nodejs.org/)
- FFmpeg في PATH (للتسجيل)
- Python + `.venv` (اختياري — للتعرف على الوجوه): `scripts\setup-face-python.bat`

## الشبكة

- الكاميرات: `192.168.x.x` — يجب أن يراها **نفس الجهاز** الذي يشغّل المشغّل.
- من خارج المكتب: VPN فقط — لا تفتح RTSP على الإنترنت.
