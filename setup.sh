#!/bin/bash

# ============================================================
# Liene APP UI 自动化环境一键部署脚本
# 使用方法：bash setup.sh
# 仓库：https://github.com/ZiHan-QA/liene-app-automation
# ============================================================

set -e

REPO_URL="https://github.com/ZiHan-QA/liene-app-automation.git"
INSTALL_DIR="$HOME/liene-app-automation"
PROFILE="$HOME/.zprofile"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
step() { echo -e "\n${YELLOW}━━━ $1 ━━━${NC}"; }

echo ""
echo "================================================"
echo "  Liene APP UI 自动化环境一键部署"
echo "================================================"
echo ""

# ── 1. Homebrew ──────────────────────────────────────────────
step "1/8  Homebrew"
if command -v brew &>/dev/null; then
  log "Homebrew 已安装，跳过"
else
  warn "正在安装 Homebrew，需要输入开机密码..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ $(uname -m) == "arm64" ]]; then
    echo >> "$PROFILE"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv zsh)"' >> "$PROFILE"
    eval "$(/opt/homebrew/bin/brew shellenv zsh)"
  fi
  log "Homebrew 安装完成"
fi

# ── 2. Node.js ───────────────────────────────────────────────
step "2/8  Node.js"
if command -v node &>/dev/null; then
  log "Node.js 已安装：$(node -v)"
else
  brew install node
  log "Node.js 安装完成：$(node -v)"
fi

# ── 3. Python 3 ──────────────────────────────────────────────
step "3/8  Python 3"
if command -v python3 &>/dev/null; then
  log "Python3 已安装：$(python3 --version)"
else
  brew install python
  log "Python3 安装完成：$(python3 --version)"
fi

# ── 4. Java (Temurin) ────────────────────────────────────────
step "4/8  Java (Temurin)"
if command -v java &>/dev/null; then
  log "Java 已安装：$(java -version 2>&1 | head -1)"
else
  brew install --cask temurin
  log "Java 安装完成"
fi

if ! grep -q "JAVA_HOME" "$PROFILE"; then
  echo 'export JAVA_HOME=$(/usr/libexec/java_home)' >> "$PROFILE"
fi

# ── 5. Android SDK / adb ─────────────────────────────────────
step "5/8  Android SDK & adb"
if command -v adb &>/dev/null; then
  log "adb 已安装：$(adb --version | head -1)"
else
  brew install --cask android-studio
  warn "Android Studio 已安装，请手动打开 SDK Manager 安装 Platform-tools"
fi

if ! grep -q "ANDROID_HOME" "$PROFILE"; then
  echo 'export ANDROID_HOME=$HOME/Library/Android/sdk' >> "$PROFILE"
  echo 'export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/build-tools/35.0.0:$PATH' >> "$PROFILE"
fi
source "$PROFILE" 2>/dev/null || true

# ── 6. Appium 2.x + 驱动 ─────────────────────────────────────
step "6/8  Appium 2.x"
if command -v appium &>/dev/null; then
  log "Appium 已安装：$(appium --version)"
else
  npm install -g appium
  log "Appium 安装完成：$(appium --version)"
fi

log "安装 UIAutomator2 驱动（Android）..."
appium driver install uiautomator2 2>/dev/null || log "UIAutomator2 已安装"

log "安装 XCUITest 驱动（iOS）..."
appium driver install xcuitest 2>/dev/null || log "XCUITest 已安装"

# ── 7. iOS 工具 ──────────────────────────────────────────────
step "7/8  iOS 工具"
if command -v idevice_id &>/dev/null; then
  log "libimobiledevice 已安装"
else
  brew install libimobiledevice ios-deploy
  log "iOS 工具安装完成"
fi

# ── 8. 拉取代码 + Python 依赖 ────────────────────────────────
step "8/8  拉取代码仓库"
if [ -d "$INSTALL_DIR" ]; then
  warn "目录已存在，执行 git pull 更新..."
  cd "$INSTALL_DIR" && git pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

log "安装 Python 依赖..."
pip3 install -r "$INSTALL_DIR/requirements.txt" --break-system-packages 2>/dev/null \
  || pip3 install -r "$INSTALL_DIR/requirements.txt"

# ── 完成 ─────────────────────────────────────────────────────
echo ""
echo "================================================"
echo -e "${GREEN}  部署完成！${NC}"
echo "================================================"
echo ""
echo "📁 框架目录：$INSTALL_DIR"
echo ""
echo "下一步操作："
echo "  1. 连接 Android 手机，开启 USB 调试"
echo "  2. 运行：source ~/.zprofile"
echo "  3. 验证设备：adb devices"
echo "  4. 启动 Appium：appium"
echo "  5. 新开终端，跑冒烟测试："
echo "     cd $INSTALL_DIR && pytest -m smoke"
echo ""
echo "⚠️  iOS 还需手动操作："
echo "  1. App Store 安装 Xcode"
echo "  2. xcode-select --install"
echo "  3. Xcode 配置 WebDriverAgent 签名"
echo ""
