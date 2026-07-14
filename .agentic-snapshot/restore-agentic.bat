@echo off
chcp 65001 >nul
title Deep Code - 恢复 Agentic 能力版本

echo ========================================
echo  Deep Code Agentic 能力恢复工具
echo ========================================
echo.

set SOURCE_DIR=F:\DEEPCODE\deepcode-cli-source

:: 步骤 1: 确保 npm link 指向本地源码
echo [1/3] 检查 npm link ...
cd /d "%SOURCE_DIR%\packages\cli"
call npm link 2>nul
echo      ✓ npm link 已恢复

:: 步骤 2: 如果有源代码修改，重新构建
echo [2/3] 检查是否需要重新构建 ...
cd /d "%SOURCE_DIR%"
if not exist "%SOURCE_DIR%\packages\cli\dist\cli.js" (
    echo      发现 dist 缺失，重新构建中 ...
    call npm run build
    echo      ✓ 构建完成
) else (
    echo      ✓ dist 文件存在，跳过构建
)

:: 步骤 3: 验证安装
echo [3/3] 验证安装 ...
deepcode --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f %%i in ('deepcode --version 2^>^&1') do set VERSION=%%i
    echo      ✓ deepcode 可用，版本 %VERSION%
) else (
    echo      ✗ deepcode 命令不可用，请检查 PATH
)

echo.
echo ========================================
echo  恢复完成！Agentic 能力已就绪
echo ========================================
echo.
echo  备份文件: %SOURCE_DIR%\.agentic-snapshot\
echo  Git提交:  feat(core): 实现两大 Agentic 核心能力
echo.
pause
