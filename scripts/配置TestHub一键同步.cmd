@echo off
chcp 65001 >nul
python "%~dp0register_testhub_protocol.py"
if errorlevel 1 (
  echo 配置失败，请确认 Python 可用后重试。
) else (
  echo 配置成功。刷新管理平台后可点击“一键同步 TestHub”。
)
pause
