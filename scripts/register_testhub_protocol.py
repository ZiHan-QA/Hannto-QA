#!/usr/bin/env python3
"""Register a per-user URL protocol that starts the scheduled TestHub sync."""

from __future__ import annotations

from pathlib import Path
import winreg


PROTOCOL = "lieneqa-sync"


def register_protocol() -> None:
    trigger = Path(__file__).with_name("trigger_testhub_sync.ps1").resolve()
    command = f'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{trigger}" "%1"'
    root_path = rf"Software\Classes\{PROTOCOL}"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root_path) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "URL:Liene QA TestHub Sync")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, root_path + r"\shell\open\command") as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, command)


if __name__ == "__main__":
    register_protocol()
    print("Liene QA TestHub one-click sync protocol registered.")
