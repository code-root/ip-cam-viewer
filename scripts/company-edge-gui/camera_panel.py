#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""واجهة: اكتشاف → تسجيل دخول → اختبار → بث عبر API + WebSocket."""
from __future__ import annotations

import threading
import tkinter as tk
from tkinter import END, BOTH, LEFT, RIGHT, X, Y, Button, Entry, Frame, Label, LabelFrame, Listbox, Message, Scrollbar, StringVar

from edge_agent import EdgeApiClient, edge_config
from edge_ws import EdgeSocketClient


class CameraWizardPanel(Frame):
    STEP_DISCOVER = "① اكتشاف"
    STEP_LOGIN = "② دخول/اختبار"
    STEP_STREAM = "③ بث WebSocket"

    def __init__(self, master, *, get_base_url, get_root, on_log, is_server_running) -> None:
        super().__init__(master)
        self.get_base_url = get_base_url
        self.get_root = get_root
        self.on_log = on_log
        self.is_server_running = is_server_running

        self.client: EdgeApiClient | None = None
        self.ws: EdgeSocketClient | None = None
        self.devices: list[dict] = []
        self.device_status: dict[str, str] = {}
        self._busy = False

        cfg = edge_config(get_root())
        self.var_cam_user = StringVar(value=cfg["camera_user"])
        self.var_cam_pass = StringVar(value=cfg.get("camera_password", ""))
        self.var_api_user = StringVar(value=cfg["api_user"])
        self.var_api_pass = StringVar(value=cfg["api_password"])
        self.var_step = StringVar(value=self.STEP_DISCOVER)
        self.var_ws = StringVar(value="Socket.IO: غير متصل")

        self._build()

    def _build(self) -> None:
        cred = LabelFrame(self, text="بيانات الدخول (من البرنامج)", padx=8, pady=6)
        cred.pack(fill=X, pady=4)

        row1 = Frame(cred)
        row1.pack(fill=X)
        Label(row1, text="مستخدم الكاميرا:", width=14, anchor="w").pack(side=LEFT)
        Entry(row1, textvariable=self.var_cam_user, width=16).pack(side=LEFT, padx=4)
        Label(row1, text="كلمة المرور:", width=10, anchor="w").pack(side=LEFT)
        Entry(row1, textvariable=self.var_cam_pass, width=16, show="•").pack(side=LEFT, padx=4)

        row2 = Frame(cred)
        row2.pack(fill=X, pady=4)
        Label(row2, text="مستخدم API:", width=14, anchor="w").pack(side=LEFT)
        Entry(row2, textvariable=self.var_api_user, width=16).pack(side=LEFT, padx=4)
        Label(row2, text="كلمة API:", width=10, anchor="w").pack(side=LEFT)
        Entry(row2, textvariable=self.var_api_pass, width=16, show="•").pack(side=LEFT, padx=4)

        steps = Frame(self)
        steps.pack(fill=X, pady=4)
        Label(steps, textvariable=self.var_step, font=("Segoe UI", 10, "bold"), fg="#0a5a8a").pack(side=LEFT)
        Label(steps, textvariable=self.var_ws, font=("Segoe UI", 9), fg="#555").pack(side=RIGHT)

        btns = Frame(self)
        btns.pack(fill=X, pady=4)
        self.btn_discover = Button(btns, text="① مسح الشبكة", width=14, command=self.run_discover)
        self.btn_discover.pack(side=LEFT, padx=3)
        self.btn_test = Button(btns, text="② اختبار الاتصال", width=14, command=self.run_test)
        self.btn_test.pack(side=LEFT, padx=3)
        self.btn_stream = Button(btns, text="③ إضافة وبدء البث", width=16, command=self.run_add_stream)
        self.btn_stream.pack(side=LEFT, padx=3)
        self.btn_ws = Button(btns, text="ربط WebSocket", width=14, command=self.run_connect_ws)
        self.btn_ws.pack(side=LEFT, padx=3)

        list_frame = LabelFrame(self, text="الكاميرات المكتشفة", padx=6, pady=6)
        list_frame.pack(fill=BOTH, expand=True, pady=4)
        scroll = Scrollbar(list_frame)
        scroll.pack(side=RIGHT, fill=Y)
        self.listbox = Listbox(
            list_frame,
            height=8,
            yscrollcommand=scroll.set,
            font=("Consolas", 9),
            selectmode=tk.SINGLE,
        )
        self.listbox.pack(fill=BOTH, expand=True)
        scroll.config(command=self.listbox.yview)

    def _device_key(self, dev: dict) -> str:
        return f"{dev['host']}:{dev.get('port', 80)}"

    def _selected_device(self) -> dict | None:
        sel = self.listbox.curselection()
        if not sel:
            return None
        idx = int(sel[0])
        if 0 <= idx < len(self.devices):
            return self.devices[idx]
        return None

    def _refresh_list(self) -> None:
        self.listbox.delete(0, END)
        for d in self.devices:
            key = self._device_key(d)
            st = self.device_status.get(key, "جديد")
            name = d.get("name") or d.get("host")
            mfr = d.get("manufacturer") or ""
            line = f"{d['host']}:{d.get('port', 80)}  {name}  [{st}]"
            if mfr:
                line += f"  ({mfr})"
            self.listbox.insert(END, line)

    def _ensure_api(self) -> EdgeApiClient:
        if not self.is_server_running():
            raise RuntimeError("شغّل السيرفر أولاً (▶ تشغيل السيرفر)")
        if self.client is None:
            base = self.get_base_url()
            self.client = EdgeApiClient(base)
            self.client.login(self.var_api_user.get().strip(), self.var_api_pass.get())
            self.on_log(f"[كاميرات] تسجيل دخول API ✓")
        return self.client

    def _async(self, fn) -> None:
        if self._busy:
            return

        def work() -> None:
            self._busy = True
            self._set_buttons(False)
            try:
                fn()
            except Exception as exc:
                self.on_log(f"[كاميرات] خطأ: {exc}")
                self.after(0, lambda: Message.showerror("خطأ", str(exc)))
            finally:
                self._busy = False
                self.after(0, lambda: self._set_buttons(True))

        threading.Thread(target=work, daemon=True).start()

    def _set_buttons(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for b in (self.btn_discover, self.btn_test, self.btn_stream, self.btn_ws):
            b.config(state=state)

    def run_discover(self) -> None:
        self._async(self._do_discover)

    def _do_discover(self) -> None:
        self.var_step.set(self.STEP_DISCOVER)
        client = self._ensure_api()
        cfg = edge_config(self.get_root())
        timeout = int(cfg["discover_timeout"])
        self.on_log(f"[كاميرات] مسح الشبكة ({timeout}ms)…")
        self.devices = client.discover(timeout_ms=timeout)
        self.device_status = {self._device_key(d): "مكتشف" for d in self.devices}
        self.after(0, self._refresh_list)
        self.on_log(f"[كاميرات] وُجد {len(self.devices)} جهاز")
        self.var_step.set(f"{self.STEP_DISCOVER} — {len(self.devices)} جهاز")

    def run_test(self) -> None:
        self._async(self._do_test)

    def _do_test(self) -> None:
        dev = self._selected_device()
        if not dev:
            raise RuntimeError("اختر كاميرا من القائمة")
        self.var_step.set(self.STEP_LOGIN)
        client = self._ensure_api()
        host = dev["host"]
        port = int(dev.get("port") or 80)
        user = self.var_cam_user.get().strip() or "admin"
        pwd = self.var_cam_pass.get()
        self.on_log(f"[كاميرات] اختبار {host}:{port} …")
        result = client.test_camera(host, port, user, pwd)
        key = self._device_key(dev)
        if result.get("ok"):
            self.device_status[key] = "✓ متصل"
            info = result.get("info") or {}
            if info.get("rtspMain"):
                self.on_log(f"[كاميرات] RTSP: {info['rtspMain']}")
            if result.get("preview", {}).get("streamName"):
                self.on_log(f"[كاميرات] معاينة جاهزة: {result['preview']['streamName']}")
            self.on_log("[كاميرات] التحقق من الاتصال ✓")
        else:
            self.device_status[key] = "✗ فشل"
            raise RuntimeError(result.get("message") or result.get("error") or "فشل الاختبار")
        self.after(0, self._refresh_list)
        self.var_step.set(f"{self.STEP_LOGIN} — {host} ✓")

    def run_add_stream(self) -> None:
        self._async(self._do_add_stream)

    def _do_add_stream(self) -> None:
        dev = self._selected_device()
        if not dev:
            raise RuntimeError("اختر كاميرا من القائمة")
        key = self._device_key(dev)
        already_linked = dev.get("linkStatus") == "exact"
        if not already_linked and self.device_status.get(key) != "✓ متصل":
            self._do_test()
            if self.device_status.get(key) != "✓ متصل":
                raise RuntimeError("نفّذ اختبار الاتصال أولاً")

        client = self._ensure_api()
        host = dev["host"]
        port = int(dev.get("port") or 80)
        user = self.var_cam_user.get().strip() or "admin"
        pwd = self.var_cam_pass.get()
        name = (dev.get("name") or host).strip() or host

        cam_id: str | None = None
        if dev.get("linkStatus") == "exact" and dev.get("exactMatches"):
            cam_id = dev["exactMatches"][0].get("id")
            self.on_log(f"[كاميرات] كاميرا مربوطة مسبقاً — {name}")
        else:
            self.on_log(f"[كاميرات] إضافة {name} …")
            created = client.create_camera(name, host, port, user, pwd)
            cam = created.get("camera") or {}
            cam_id = cam.get("id")
            self.on_log(f"[كاميرات] أُضيفت ✓ id={cam_id}")

        if not cam_id:
            raise RuntimeError("لا يوجد معرّف كاميرا")

        self.var_step.set(self.STEP_STREAM)
        self.on_log(f"[كاميرات] بدء البث عبر API …")
        stream = client.start_stream(cam_id, "sub")
        base = self.get_base_url()
        urls = stream.get("urls") or {}
        ws_path = urls.get("ws", "")
        hls = urls.get("hls", "")
        self.on_log(f"[كاميرات] stream: {stream.get('streamName')}")
        if hls:
            self.on_log(f"[كاميرات] HLS: {base}{hls}")
        if ws_path:
            self.on_log(f"[كاميرات] WebSocket (real-time): {base}{ws_path}")

        self._connect_ws_and_subscribe(cam_id)
        self.device_status[key] = "● يبث"
        self.after(0, self._refresh_list)
        self.var_step.set(f"{self.STEP_STREAM} — {name}")

    def run_connect_ws(self) -> None:
        self._async(self._connect_ws_only)

    def _connect_ws_only(self) -> None:
        self._ensure_api()
        dev = self._selected_device()
        cam_id = None
        if dev and dev.get("exactMatches"):
            cam_id = dev["exactMatches"][0].get("id")
        self._connect_ws_and_subscribe(cam_id)

    def _connect_ws_and_subscribe(self, camera_id: str | None) -> None:
        assert self.client and self.client.token
        base = self.get_base_url()
        if self.ws:
            try:
                self.ws.disconnect()
            except Exception:
                pass
        self.ws = EdgeSocketClient(base, self.client.token, self.on_log)
        self.ws.connect()
        if camera_id:
            self.ws.subscribe_camera(camera_id)
        self.after(0, lambda: self.var_ws.set("Socket.IO: متصل ✓"))

    def on_server_stopped(self) -> None:
        if self.ws:
            try:
                self.ws.disconnect()
            except Exception:
                pass
        self.ws = None
        self.client = None
        self.var_ws.set("Socket.IO: غير متصل")
