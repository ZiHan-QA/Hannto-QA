#!/usr/bin/env python3
"""Validate and store sync credentials, then register the 30-minute task."""

from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk

import sync_testhub_local as sync
from windows_credentials import write_credential


PINGCODE_CREDENTIAL = "LieneQA/HanntonbApiKey"
SUPABASE_CREDENTIAL = "LieneQA/SupabaseSyncAccount"
TASK_NAME = "Liene QA TestHub Progress Sync"


def register_task() -> None:
    runner = Path(__file__).with_name("run_scheduled_testhub_sync.ps1").resolve()
    task_command = f'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{runner}"'
    result = subprocess.run(
        [
            "schtasks.exe", "/Create", "/TN", TASK_NAME,
            "/TR", task_command, "/SC", "MINUTE", "/MO", "30", "/F",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "Task Scheduler registration failed").strip())


def run_task_now() -> None:
    subprocess.run(
        ["schtasks.exe", "/Run", "/TN", TASK_NAME],
        capture_output=True,
        timeout=15,
        check=False,
    )


def main() -> None:
    root = tk.Tk()
    root.title("Liene QA TestHub 自动同步配置")
    root.geometry("620x330")
    root.resizable(False, False)

    frame = ttk.Frame(root, padding=20)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="凭据将由当前 Windows 用户加密保存，不写入项目或 GitHub。", foreground="#6b5b73").grid(
        row=0, column=0, columnspan=2, sticky="w", pady=(0, 16)
    )

    ttk.Label(frame, text="Hanntonb API Key").grid(row=1, column=0, sticky="w", pady=7)
    key_entry = ttk.Entry(frame, width=55, show="●")
    key_entry.grid(row=1, column=1, sticky="ew", pady=7)

    ttk.Label(frame, text="管理平台登录邮箱").grid(row=2, column=0, sticky="w", pady=7)
    email_entry = ttk.Entry(frame, width=55)
    email_entry.grid(row=2, column=1, sticky="ew", pady=7)

    ttk.Label(frame, text="管理平台登录密码").grid(row=3, column=0, sticky="w", pady=7)
    password_entry = ttk.Entry(frame, width=55, show="●")
    password_entry.grid(row=3, column=1, sticky="ew", pady=7)

    status_var = tk.StringVar(value="填写后点击“验证并启用”，首次验证约需数秒。")
    ttk.Label(frame, textvariable=status_var, foreground="#79556b").grid(
        row=4, column=0, columnspan=2, sticky="w", pady=(16, 10)
    )

    button = ttk.Button(frame, text="验证并启用每 30 分钟同步")
    button.grid(row=5, column=0, columnspan=2, pady=10)
    frame.columnconfigure(1, weight=1)

    def finish_success() -> None:
        key_entry.delete(0, tk.END)
        password_entry.delete(0, tk.END)
        button.config(state="normal")
        status_var.set("配置成功：Windows 任务已创建，并已触发首次进度同步。")
        messagebox.showinfo("配置成功", "已安全保存凭据，并创建每 30 分钟运行一次的同步任务。")

    def finish_error(message: str) -> None:
        button.config(state="normal")
        status_var.set("配置失败，请检查提示后重试。")
        messagebox.showerror("配置失败", message)

    def worker(api_key: str, email: str, password: str) -> None:
        try:
            sync.validate_pingcode_token(api_key)
            access_token, user_id = sync.authenticate_supabase(email, password)
            validated_user_id, _ = sync.validate_supabase_access_token(access_token)
            if validated_user_id != user_id:
                raise RuntimeError("Supabase 用户验证不一致")
            write_credential(PINGCODE_CREDENTIAL, "hanntonb", api_key)
            write_credential(SUPABASE_CREDENTIAL, email, password)
            register_task()
            run_task_now()
            root.after(0, finish_success)
        except Exception as error:
            root.after(0, finish_error, str(error))
        finally:
            api_key = ""
            password = ""

    def submit() -> None:
        api_key = key_entry.get().strip()
        email = email_entry.get().strip()
        password = password_entry.get()
        if not api_key or not email or not password:
            messagebox.showerror("缺少信息", "请填写 Hanntonb API Key、管理平台邮箱和密码。")
            return
        button.config(state="disabled")
        status_var.set("正在验证两组凭据并创建定时任务…")
        threading.Thread(target=worker, args=(api_key, email, password), daemon=True).start()

    button.config(command=submit)
    key_entry.focus_set()
    root.mainloop()


if __name__ == "__main__":
    main()
