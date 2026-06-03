#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
عارض كاميرات — مشغّل جهاز الشركة (واجهة رسومية)
يشغّل API + الواجهة + WebSocket + go2rtc + مسح الوجوه على جهاز Windows داخل الشبكة المحلية.
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path
from tkinter import (
    BOTH,
    END,
    LEFT,
    RIGHT,
    Button,
    Frame,
    Label,
    LabelFrame,
    Message,
    Scrollbar,
    Text,
    Tk,
    X,
    Y,
)

APP_TITLE = "IP Camera Viewer — مشغّل جهاز الشركة"
DEFAULT_PORT = 3000


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_dir() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def find_project_root() -> Path:
    """يبحث عن مجلد المشروع (يحتوي package.json و server/)."""
    candidates = [app_dir(), *app_dir().parents]
    for p in candidates:
        if (p / "package.json").is_file() and (p / "server").is_dir():
            return p
    return app_dir().parent.parent


ROOT = find_project_root()
LOG_QUEUE: queue.Queue[str] = queue.Queue()


@dataclass
class PrereqStatus:
    node: bool = False
    npm: bool = False
    go2rtc: bool = False
    python_venv: bool = False
    client_built: bool = False
    env_file: bool = False

    @property
    def ready(self) -> bool:
        return self.node and self.npm and self.env_file


class EdgeServerProcess:
    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self._reader: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self, env: dict[str, str], cwd: Path) -> None:
        if self.running:
            raise RuntimeError("السيرفر يعمل بالفعل")
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js غير مثبت")
        server_js = cwd / "server" / "dist" / "index.js"
        if not server_js.is_file():
            raise RuntimeError("لم يُبنَ السيرفر بعد — اضغط «إعداد أولي»")
        self.proc = subprocess.Popen(
            [node, str(server_js)],
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()

    def _pump(self) -> None:
        assert self.proc and self.proc.stdout
        for line in self.proc.stdout:
            LOG_QUEUE.put(line.rstrip())
        code = self.proc.wait() if self.proc else -1
        LOG_QUEUE.put(f"[مشغّل] توقف السيرفر (رمز {code})")

    def stop(self) -> None:
        if not self.proc:
            return
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(self.proc.pid)],
                    capture_output=True,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
            else:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
        except Exception as exc:
            LOG_QUEUE.put(f"[مشغّل] خطأ عند الإيقاف: {exc}")
        finally:
            self.proc = None


def detect_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        pass
    try:
        return socket.gethostbyname(socket.gethostname())
    except OSError:
        return "127.0.0.1"


def check_prereqs(root: Path) -> PrereqStatus:
    st = PrereqStatus()
    st.node = shutil.which("node") is not None
    st.npm = shutil.which("npm") is not None
    st.go2rtc = (root / "bin" / "go2rtc.exe").is_file() or (root / "bin" / "go2rtc").is_file()
    st.python_venv = (root / ".venv" / "Scripts" / "python.exe").is_file() or (
        root / ".venv" / "bin" / "python"
    ).is_file()
    st.client_built = (root / "client" / "dist" / "index.html").is_file()
    st.env_file = (root / ".env").is_file()
    return st


def build_edge_env(root: Path, lan_ip: str) -> dict[str, str]:
    env = os.environ.copy()
    port = os.environ.get("PORT", str(DEFAULT_PORT))
    env.update(
        {
            "HOST": "0.0.0.0",
            "PORT": port,
            "SERVE_CLIENT": "true",
            "NODE_ENV": "production",
            "CLIENT_URL": f"http://{lan_ip}:{port}",
            "DATABASE_URL": "file:./server/data/app.db",
            "GO2RTC_BIN": str(root / "bin" / ("go2rtc.exe" if sys.platform == "win32" else "go2rtc")),
            "PYTHON_BIN": str(
                root / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
            ),
        }
    )
    return env


def run_cmd(cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> int:
    LOG_QUEUE.put(f"[أمر] {' '.join(cmd)}")
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env or os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    assert proc.stdout
    for line in proc.stdout:
        LOG_QUEUE.put(line.rstrip())
    return proc.wait()


def ensure_env_file(root: Path) -> None:
    env_path = root / ".env"
    if env_path.is_file():
        return
    for name in (".env.company-edge.example", ".env.example"):
        src = root / name
        if src.is_file():
            shutil.copy(src, env_path)
            LOG_QUEUE.put(f"[إعداد] نُسخ {name} → .env")
            return
    env_path.write_text(
        "HOST=0.0.0.0\nPORT=3000\nSERVE_CLIENT=true\nJWT_SECRET=CHANGE-ME-32-CHARS-MINIMUM!!\n",
        encoding="utf-8",
    )


def health_ok(base_url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{base_url}/api/health", timeout=2) as resp:
            data = json.loads(resp.read().decode())
            return bool(data.get("ok"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return False


class CompanyEdgeApp:
    def __init__(self) -> None:
        self.root_path = ROOT
        self.server = EdgeServerProcess()
        self.lan_ip = detect_lan_ip()
        self.port = DEFAULT_PORT
        self._busy = False

        self.tk = Tk()
        self.tk.title(APP_TITLE)
        self.tk.minsize(720, 520)
        self.tk.protocol("WM_DELETE_WINDOW", self.on_close)

        self._build_ui()
        self._poll_log()
        self.refresh_status()

    def _build_ui(self) -> None:
        header = Frame(self.tk, padx=12, pady=10)
        header.pack(fill=X)
        Label(header, text=APP_TITLE, font=("Segoe UI", 14, "bold")).pack(anchor="w")
        Label(
            header,
            text="شغّل النظام على PC داخل الشركة — الكاميرات RTSP محلية، الوصول عبر المتصفح",
            font=("Segoe UI", 10),
        ).pack(anchor="w")

        info = LabelFrame(self.tk, text="معلومات التشغيل", padx=10, pady=8)
        info.pack(fill=X, padx=12, pady=4)
        self.lbl_project = Label(info, text="", justify=LEFT, font=("Consolas", 9))
        self.lbl_project.pack(anchor="w")
        self.lbl_urls = Label(info, text="", justify=LEFT, font=("Segoe UI", 10))
        self.lbl_urls.pack(anchor="w", pady=4)
        self.lbl_status = Label(info, text="", font=("Segoe UI", 10, "bold"))
        self.lbl_status.pack(anchor="w")

        prereq = LabelFrame(self.tk, text="المتطلبات", padx=10, pady=8)
        prereq.pack(fill=X, padx=12, pady=4)
        self.lbl_prereq = Label(prereq, text="", justify=LEFT, font=("Segoe UI", 9))
        self.lbl_prereq.pack(anchor="w")

        btns = Frame(self.tk, padx=12, pady=8)
        btns.pack(fill=X)
        self.btn_setup = Button(btns, text="إعداد أولي", width=14, command=self.run_setup)
        self.btn_setup.pack(side=LEFT, padx=4)
        self.btn_start = Button(btns, text="▶ تشغيل السيرفر", width=16, command=self.start_server)
        self.btn_start.pack(side=LEFT, padx=4)
        self.btn_stop = Button(btns, text="■ إيقاف", width=10, command=self.stop_server)
        self.btn_stop.pack(side=LEFT, padx=4)
        self.btn_browser = Button(btns, text="فتح المتصفح", width=12, command=self.open_browser)
        self.btn_browser.pack(side=LEFT, padx=4)
        self.btn_refresh = Button(btns, text="تحديث", width=8, command=self.refresh_status)
        self.btn_refresh.pack(side=RIGHT, padx=4)

        log_frame = LabelFrame(self.tk, text="سجل التشغيل", padx=8, pady=8)
        log_frame.pack(fill=BOTH, expand=True, padx=12, pady=8)
        scroll = Scrollbar(log_frame)
        scroll.pack(side=RIGHT, fill=Y)
        self.log_text = Text(log_frame, height=14, wrap="word", yscrollcommand=scroll.set, font=("Consolas", 9))
        self.log_text.pack(fill=BOTH, expand=True)
        scroll.config(command=self.log_text.yview)

        foot = Label(
            self.tk,
            text="من الإنترنت: استخدم VPN (Tailscale) — لا تفتح منفذ RTSP",
            font=("Segoe UI", 8),
            fg="#666",
        )
        foot.pack(pady=4)

    def log(self, msg: str) -> None:
        self.log_text.insert(END, msg + "\n")
        self.log_text.see(END)

    def _poll_log(self) -> None:
        while True:
            try:
                line = LOG_QUEUE.get_nowait()
                self.log(line)
            except queue.Empty:
                break
        if self.server.running:
            base = f"http://127.0.0.1:{self.port}"
            ok = health_ok(base)
            self.lbl_status.config(
                text="● السيرفر يعمل" if ok else "● السيرفر يقلع…",
                fg="#0a7a0a" if ok else "#b8860b",
            )
        self.tk.after(200, self._poll_log)

    def refresh_status(self) -> None:
        self.lan_ip = detect_lan_ip()
        self.root_path = find_project_root()
        st = check_prereqs(self.root_path)
        base = f"http://{self.lan_ip}:{self.port}"
        self.lbl_project.config(
            text=f"مجلد المشروع:\n  {self.root_path}\n"
            f"وضع التشغيل: منفذ واحد (UI + API + WebSocket + go2rtc)"
        )
        self.lbl_urls.config(
            text=f"افتح من الشبكة المحلية:\n  {base}\n"
            f"التحقق الصحي:\n  {base}/api/health\n"
            f"تسجيل الدخول الافتراضي: admin / admin123"
        )
        lines = [
            f"{'✓' if st.node else '✗'} Node.js",
            f"{'✓' if st.npm else '✗'} npm",
            f"{'✓' if st.env_file else '✗'} ملف .env",
            f"{'✓' if st.go2rtc else '○'} go2rtc (يُحمّل عند الإعداد)",
            f"{'✓' if st.python_venv else '○'} Python .venv (اختياري للوجوه)",
            f"{'✓' if st.client_built else '○'} بناء الواجهة (يُنفَّذ عند الإعداد)",
        ]
        self.lbl_prereq.config(text="\n".join(lines))
        if not self.server.running:
            self.lbl_status.config(text="○ متوقف", fg="#888")

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        state = "disabled" if busy else "normal"
        self.btn_setup.config(state=state)
        self.btn_start.config(state=state)

    def _run_async(self, fn) -> None:
        if self._busy:
            return

        def wrapper() -> None:
            self._set_busy(True)
            try:
                fn()
            except Exception as exc:
                LOG_QUEUE.put(f"[خطأ] {exc}")
                self.tk.after(0, lambda: Message.showerror("خطأ", str(exc)))
            finally:
                self._set_busy(False)
                self.tk.after(0, self.refresh_status)

        threading.Thread(target=wrapper, daemon=True).start()

    def run_setup(self) -> None:
        self._run_async(self._do_setup)

    def _do_setup(self) -> None:
        root = self.root_path
        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("ثبّت Node.js من https://nodejs.org/")
        ensure_env_file(root)
        if not shutil.which("node"):
            raise RuntimeError("Node.js غير موجود في PATH")

        code = run_cmd([npm, "install"], root)
        if code != 0:
            raise RuntimeError("فشل npm install")

        run_cmd([npm, "install", "http-proxy@^1.18.1", "-w", "server"], root)

        if not (root / "bin" / "go2rtc.exe").is_file() and not (root / "bin" / "go2rtc").is_file():
            run_cmd([npm, "run", "go2rtc:install"], root)

        code = run_cmd([npm, "run", "build"], root)
        if code != 0:
            raise RuntimeError("فشل npm run build")

        env = os.environ.copy()
        env["DATABASE_URL"] = "file:./server/data/app.db"
        run_cmd(["npx", "prisma", "migrate", "deploy"], root / "server", env)

        LOG_QUEUE.put("[إعداد] اكتمل الإعداد — يمكنك تشغيل السيرفر")

    def start_server(self) -> None:
        if self.server.running:
            Message.showwarning("تنبيه", "السيرفر يعمل بالفعل")
            return
        self._run_async(self._do_start)

    def _do_start(self) -> None:
        root = self.root_path
        st = check_prereqs(root)
        if not st.client_built:
            raise RuntimeError("نفّذ «إعداد أولي» أولاً")
        ensure_env_file(root)
        self.lan_ip = detect_lan_ip()
        env = build_edge_env(root, self.lan_ip)
        self.server.start(env, root)
        LOG_QUEUE.put(f"[مشغّل] بدء السيرفر — {env['CLIENT_URL']}")
        for _ in range(30):
            if health_ok(f"http://127.0.0.1:{self.port}"):
                LOG_QUEUE.put("[مشغّل] السيرفر جاهز ✓")
                break
            time.sleep(0.5)

    def stop_server(self) -> None:
        self.server.stop()
        LOG_QUEUE.put("[مشغّل] تم إيقاف السيرفر")
        self.refresh_status()

    def open_browser(self) -> None:
        url = f"http://{self.lan_ip}:{self.port}"
        webbrowser.open(url)

    def on_close(self) -> None:
        if self.server.running:
            if not Message.askyesno("إيقاف", "إيقاف السيرفر والخروج؟"):
                return
            self.server.stop()
        self.tk.destroy()


def main() -> None:
    if not (ROOT / "package.json").is_file():
        root = Tk()
        root.withdraw()
        Message.showerror(
            "مجلد غير صحيح",
            f"ضع الملف التنفيذي داخل مجلد المشروع ip-cam-viewer\n"
            f"(يجب أن يوجد package.json)\n\nالمسار الحالي:\n{ROOT}",
        )
        root.destroy()
        return
    CompanyEdgeApp().tk.mainloop()


if __name__ == "__main__":
    main()
