@echo off
:: Включаем поддержку UTF-8 и скрываем вывод команды (>nul)
chcp 65001 >nul

echo Запускаем компоненты... ^_^

:: 1. React App
start "React App" /d "rekordkaraoke" npm start

:: Ждем 2 секунды
timeout /t 2 /nobreak >nul

:: 2. Python Bridge
start "Python Bridge" python bridge.py

:: 3. RKBX OSC
start "RKBX OSC" "src-rust\target\release\rkbx_osc.exe"

echo Готово! Все системы работают <3
exit