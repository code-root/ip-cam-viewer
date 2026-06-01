# IP Camera Viewer — ONVIF / RTSP

عارض كاميرات IP متعدد على الشبكة المحلية مع ONVIF و RTSP.

## المتطلبات

- Node.js 20+
- FFmpeg
  - **macOS:** `brew install ffmpeg`
  - **Windows:** [تحميل FFmpeg](https://www.gyan.dev/ffmpeg/builds/) وأضف مجلد `bin` إلى PATH
- go2rtc — `npm run go2rtc:install` أو حمّله يدوياً من [Releases](https://github.com/AlexxIT/go2rtc/releases)

## التشغيل السريع

### macOS / Linux

```bash
cp .env.example .env
# عدّل JWT_SECRET و ENCRYPTION_KEY

npm install
npm run db:migrate
npm run db:seed
npm run go2rtc:install   # اختياري إن لم يكن go2rtc مثبتاً
npm run dev
```

### Windows

1. ثبّت [Node.js LTS](https://nodejs.org/) و [FFmpeg](https://www.gyan.dev/ffmpeg/builds/) (أضفه إلى PATH).
2. من **Command Prompt** أو **PowerShell** في مجلد المشروع:

```bat
scripts\setup-windows.bat
```

أو يدوياً:

```bat
copy .env.example .env
npm install
npm run db:generate
cd server && npx prisma migrate deploy && cd ..
npm run db:seed
npm run go2rtc:install
scripts\setup-face-python.bat
npm run dev
```

3. في ملف `.env` (إن لزم):

```env
GO2RTC_BIN=./bin/go2rtc.exe
PYTHON_BIN=.venv\Scripts\python.exe
```

- الواجهة: http://localhost:5173
- API: http://localhost:3000
- go2rtc: http://localhost:1984

**حساب افتراضي:** `admin` / `admin123` (غيّر كلمة المرور فوراً)

## الميزات

- عدة كاميرات، شبكة 1/4/6/9/16، تكبير رقمي و PTZ
- اكتشاف ONVIF، تسجيل، playback، RBAC
- PiP، Tour، Wall mode، خريطة أرضية، إشعارات، 2FA، نسخ احتياطي
- **التعرف على الوجوه:** تسجيل موظفين، بصمة وجه، سجل حركة تفصيلي لكل موظف عبر الكاميرات

## التعرف على الوجوه

| النظام | الأمر |
|--------|--------|
| macOS / Linux | `bash scripts/setup-face-python.sh` أو `npm run setup:face` |
| Windows | `scripts\setup-face-python.bat` أو `npm run setup:face:win` |

1. من **الموظفون** → أضف موظفاً (رقم، اسم، قسم).
2. **تسجيل الوجه** — ارفع صورة واضحة للوجه من الأمام (يمكن عدة صور).
3. يفحص النظام الكاميرات كل ~12 ثانية ويسجّل: أين، متى، مدة البقاء.
4. **سجل الحضور والحركة** — تقرير يومي + تفاصيل كل موظف.

**Windows:** قد يتطلب `face_recognition` تثبيت [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (حمل C++) أو تثبيت `dlib` يدوياً عبر pip.

متغيرات: `FACE_SCAN_INTERVAL_SEC`, `FACE_MATCH_THRESHOLD` (أقل = أدق), `FACE_ABSENCE_CLOSE_SEC`.

## أوامر npm مفيدة

| الأمر | الوصف |
|--------|--------|
| `npm run dev` | تشغيل السيرفر + الواجهة |
| `npm run go2rtc:install` | تحميل go2rtc للنظام الحالي |
| `npm run db:deploy` | تطبيق migrations (مناسب للإنتاج و Windows) |
| `npm run setup:win` | إعداد كامل على Windows |
