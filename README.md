# IP Camera Viewer — ONVIF / RTSP

عارض كاميرات IP متعدد على الشبكة المحلية مع ONVIF و RTSP.

## المتطلبات

- Node.js 20+
- FFmpeg (`brew install ffmpeg`)
- go2rtc binary — ضعه في `bin/go2rtc` أو عيّن `GO2RTC_BIN` في `.env`

تحميل go2rtc: https://github.com/AlexxIT/go2rtc/releases

## التشغيل

```bash
cp .env.example .env
# عدّل JWT_SECRET و ENCRYPTION_KEY

npm install
npm run db:migrate
npm run db:seed
npm run dev
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

```bash
pip install face_recognition pillow   # مطلوب للتعرف على الوجوه على السيرفر
```

1. من **الموظفون** → أضف موظفاً (رقم، اسم، قسم).
2. **تسجيل الوجه** — ارفع صورة واضحة للوجه من الأمام (يمكن عدة صور).
3. يفحص النظام الكاميرات كل ~12 ثانية ويسجّل: أين، متى، مدة البقاء.
4. **سجل الحضور والحركة** — تقرير يومي + تفاصيل كل موظف.

متغيرات: `FACE_SCAN_INTERVAL_SEC`, `FACE_MATCH_THRESHOLD` (أقل = أدق), `FACE_ABSENCE_CLOSE_SEC`.
