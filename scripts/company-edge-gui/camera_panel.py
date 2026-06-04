#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Per-camera credentials (like website) → discover → test → stream."""
from __future__ import annotations

import threading
import tkinter as tk
from tkinter import END, BOTH, LEFT, RIGHT, X, Y, Button, Entry, Frame, Label, LabelFrame, Listbox, Message, Scrollbar, StringVar

from edge_agent import EdgeApiClient, edge_config
from edge_ws import EdgeSocketClient


class CameraWizardPanel(Frame):
    def __init__(
        self,
        master,
        *,
        get_root,
        on_log,
        ensure_server,
    ) -> None:
        super().__init__(master)
        self.get_root = get_root
        self.on_log = on_log
        self.ensure_server = ensure_server

        self.client: EdgeApiClient | None = None
        self.ws: EdgeSocketClient | None = None
        self.devices: list[dict] = []
        self.device_status: dict[str, str] = {}
        self.device_creds: dict[str, dict[str, str]] = {}
        self._busy = False

        cfg = edge_config(get_root())
        self.var_host = StringVar(value=cfg["host_url"])
        self.var_sel_label = StringVar(value="No camera selected")
        self.var_cam_user = StringVar(value="admin")
        self.var_cam_pass = StringVar(value="")
        self.var_api_user = StringVar(value=cfg["api_user"])
        self.var_api_pass = StringVar(value=cfg["api_password"])
        self.var_step = StringVar(value="① Discover → ② Select camera → enter its password → Test → Stream")
        self.var_ws = StringVar(value="Socket.IO: offline")

        self._build()

    def get_base_url(self) -> str:
        return self.var_host.get().strip().rstrip("/") or "http://127.0.0.1:3000"

    def _build(self) -> None:
        host_row = Frame(self)
        host_row.pack(fill=X, pady=2)
        Label(host_row, text="Host API:", width=10, anchor="w").pack(side=LEFT)
        Entry(host_row, textvariable=self.var_host, width=42).pack(side=LEFT, fill=X, expand=True, padx=4)

        api_row = LabelFrame(self, text="API login (server)", padx=8, pady=4)
        api_row.pack(fill=X, pady=2)
        r = Frame(api_row)
        r.pack(fill=X)
        Label(r, text="User:", width=8).pack(side=LEFT)
        Entry(r, textvariable=self.var_api_user, width=12).pack(side=LEFT, padx=4)
        Label(r, text="Pass:", width=6).pack(side=LEFT)
        Entry(r, textvariable=self.var_api_pass, width=12, show="•").pack(side=LEFT, padx=4)

        cred = LabelFrame(self, text="Selected camera login (each camera is different — like the website)", padx=8, pady=6)
        cred.pack(fill=X, pady=4)
        Label(cred, textvariable=self.var_sel_label, font=("Segoe UI", 9, "bold"), fg="#333").pack(anchor="w")
        row1 = Frame(cred)
        row1.pack(fill=X, pady=4)
        Label(row1, text="Username:", width=10, anchor="w").pack(side=LEFT)
        Entry(row1, textvariable=self.var_cam_user, width=18).pack(side=LEFT, padx=4)
        Label(row1, text="Password:", width=8, anchor="w").pack(side=LEFT)
        Entry(row1, textvariable=self.var_cam_pass, width=18, show="•").pack(side=LEFT, padx=4)
        Label(
            cred,
            text="Tip: select a camera in the list — enter its own username/password — then Test",
            font=("Segoe UI", 8),
            fg="#666",
        ).pack(anchor="w")

        steps = Frame(self)
        steps.pack(fill=X, pady=4)
        Label(steps, textvariable=self.var_step, font=("Segoe UI", 9, "bold"), fg="#0a5a8a").pack(side=LEFT)
        Label(steps, textvariable=self.var_ws, font=("Segoe UI", 9), fg="#555").pack(side=RIGHT)

        btns = Frame(self)
        btns.pack(fill=X, pady=4)
        self.btn_discover = Button(
            btns, text="① Discover (starts server)", width=22, command=self.run_discover
        )
        self.btn_discover.pack(side=LEFT, padx=3)
        self.btn_test = Button(btns, text="② Test this camera", width=14, command=self.run_test)
        self.btn_test.pack(side=LEFT, padx=3)
        self.btn_stream = Button(btns, text="③ Stream API", width=12, command=self.run_add_stream)
        self.btn_stream.pack(side=LEFT, padx=3)
        self.btn_all = Button(btns, text="▶ Test + Stream", width=12, command=self.run_pipeline_selected)
        self.btn_all.pack(side=LEFT, padx=3)

        list_frame = LabelFrame(self, text="Discovered cameras", padx=6, pady=6)
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
        self.listbox.bind("<<ListboxSelect>>", self._on_select_device)

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

    def _save_creds_for_selected(self) -> None:
        dev = self._selected_device()
        if not dev:
            return
        key = self._device_key(dev)
        self.device_creds[key] = {
            "username": self.var_cam_user.get().strip() or "admin",
            "password": self.var_cam_pass.get(),
        }

    def _load_creds_for_selected(self) -> None:
        dev = self._selected_device()
        if not dev:
            self.var_sel_label.set("No camera selected")
            return
        key = self._device_key(dev)
        name = dev.get("name") or dev.get("host")
        self.var_sel_label.set(f"{dev['host']}:{dev.get('port', 80)} — {name}")
        saved = self.device_creds.get(key)
        if saved:
            self.var_cam_user.set(saved.get("username", "admin"))
            self.var_cam_pass.set(saved.get("password", ""))
        else:
            self.var_cam_user.set("admin")
            self.var_cam_pass.set("")

    def _on_select_device(self, _event=None) -> None:
        self._load_creds_for_selected()

    def _creds_for_device(self, dev: dict) -> tuple[str, str]:
        key = self._device_key(dev)
        saved = self.device_creds.get(key)
        if saved:
            return saved.get("username", "admin"), saved.get("password", "")
        user = self.var_cam_user.get().strip() or "admin"
        pwd = self.var_cam_pass.get()
        return user, pwd

    def _refresh_list(self) -> None:
        self.listbox.delete(0, END)
        for d in self.devices:
            key = self._device_key(d)
            st = self.device_status.get(key, "new")
            name = d.get("name") or d.get("host")
            mfr = d.get("manufacturer") or ""
            line = f"{d['host']}:{d.get('port', 80)}  {name}  [{st}]"
            if mfr:
                line += f"  ({mfr})"
            self.listbox.insert(END, line)

    def _reset_client(self) -> None:
        self.client = None

    def _ensure_host_api(self) -> EdgeApiClient:
        base = self.ensure_server(self.get_base_url())
        if self.client is None or self.client.base != base.rstrip("/"):
            self.client = EdgeApiClient(base)
            self.client.login(self.var_api_user.get().strip(), self.var_api_pass.get())
            self.on_log("[cameras] Host API login OK")
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
                msg = str(exc)
                self.on_log(f"[cameras] error: {msg}")
                if "AUTH_FAILED" in msg or "Invalid username" in msg:
                    msg += (
                        "\n\nWrong username/password for THIS camera."
                        "\nEach camera has different credentials (like the website)."
                        "\nPort 2020 = check camera manual for ONVIF user/pass."
                    )
                elif "AUTH_REQUIRED" in msg:
                    msg += "\n\nEnter this camera's password in the fields above."
                self.after(0, lambda m=msg: Message.showerror("Error", m))
            finally:
                self._busy = False
                self.after(0, lambda: self._set_buttons(True))

        threading.Thread(target=work, daemon=True).start()

    def _set_buttons(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for b in (self.btn_discover, self.btn_test, self.btn_stream, self.btn_all):
            b.config(state=state)

    def run_discover(self) -> None:
        self._async(self._do_discover)

    def _do_discover(self) -> None:
        self.var_step.set("① Discovering…")
        self._reset_client()
        client = self._ensure_host_api()
        cfg = edge_config(self.get_root())
        timeout = int(cfg["discover_timeout"])
        subnet = bool(cfg.get("subnet_scan"))
        mode = "ONVIF multicast only" if not subnet else "full subnet scan"
        self.on_log(f"[cameras] Discover ({mode}, {timeout}ms)")
        self.devices = client.discover(timeout_ms=timeout, subnet_scan=subnet)
        self.device_status = {self._device_key(d): "found" for d in self.devices}
        self.after(0, self._refresh_list)
        self.on_log(f"[cameras] Found {len(self.devices)} — select one and enter its password")
        self.var_step.set(f"① Found {len(self.devices)} — select camera + enter password")

    def run_test(self) -> None:
        self._async(self._do_test)

    def _do_test(self) -> None:
        dev = self._selected_device()
        if not dev:
            raise RuntimeError("Select a camera from the list first")
        self._save_creds_for_selected()
        user, pwd = self._creds_for_device(dev)
        if not pwd:
            raise RuntimeError("Enter this camera's password (each camera has different credentials)")

        self.var_step.set("② Testing login…")
        client = self._ensure_host_api()
        host = dev["host"]
        port = int(dev.get("port") or 80)
        self.on_log(f"[cameras] Test {host}:{port} as {user} …")
        result = client.test_camera(host, port, user, pwd)
        key = self._device_key(dev)
        if result.get("ok"):
            self.device_status[key] = "OK"
            info = result.get("info") or {}
            if info.get("rtspMain"):
                self.on_log(f"[cameras] RTSP: {info['rtspMain']}")
            self.on_log("[cameras] Connection OK")
        else:
            self.device_status[key] = "FAIL"
            raise RuntimeError(result.get("message") or result.get("error") or "Test failed")
        self.after(0, self._refresh_list)
        self.var_step.set(f"② {host} — OK")

    def run_add_stream(self) -> None:
        self._async(self._do_add_stream)

    def run_pipeline_selected(self) -> None:
        self._async(self._do_pipeline_selected)

    def _do_pipeline_selected(self) -> None:
        dev = self._selected_device()
        if not dev:
            raise RuntimeError("Select a camera first")
        self._do_test()
        self._do_add_stream()

    def _do_add_stream(self) -> None:
        dev = self._selected_device()
        if not dev:
            raise RuntimeError("Select a camera from the list")
        self._save_creds_for_selected()
        user, pwd = self._creds_for_device(dev)
        if not pwd:
            raise RuntimeError("Enter this camera's password before streaming")

        key = self._device_key(dev)
        if self.device_status.get(key) != "OK":
            self._do_test()
            if self.device_status.get(key) != "OK":
                raise RuntimeError("Test connection failed — check username/password")

        client = self._ensure_host_api()
        host = dev["host"]
        port = int(dev.get("port") or 80)
        name = (dev.get("name") or host).strip() or host

        cam_id: str | None = None
        if dev.get("linkStatus") == "exact" and dev.get("exactMatches"):
            cam_id = dev["exactMatches"][0].get("id")
            self.on_log(f"[cameras] Update credentials on linked camera — {name}")
            client.update_camera(cam_id, username=user, password=pwd)
        else:
            self.on_log(f"[cameras] Add {name} …")
            created = client.create_camera(name, host, port, user, pwd)
            cam_id = (created.get("camera") or {}).get("id")
            self.on_log(f"[cameras] Added id={cam_id}")

        if not cam_id:
            raise RuntimeError("No camera id")

        self.var_step.set("③ Starting stream…")
        stream = client.start_stream(cam_id, "sub")
        base = self.get_base_url()
        urls = stream.get("urls") or {}
        ws_path = urls.get("ws", "")
        self.on_log(f"[cameras] stream: {stream.get('streamName')}")
        if ws_path:
            self.on_log(f"[cameras] Real-time WS: {base}{ws_path}")

        self._connect_ws_and_subscribe(cam_id)
        self.device_status[key] = "LIVE"
        self.after(0, self._refresh_list)
        self.var_step.set(f"③ LIVE — {name}")

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
        self.after(0, lambda: self.var_ws.set("Socket.IO: connected"))

    def on_server_stopped(self) -> None:
        if self.ws:
            try:
                self.ws.disconnect()
            except Exception:
                pass
        self.ws = None
        self.client = None
        self.var_ws.set("Socket.IO: offline")
