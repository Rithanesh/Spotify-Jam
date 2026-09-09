@echo off
REM Builds a single-file backend binary using the project's own venv (not
REM system Python) so the build is reproducible and doesn't pick up
REM unrelated packages. Output lands in backend\dist\, picked up by
REM electron-builder's extraResources (see ..\package.json).
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist .venv (
    echo No venv found — run ..\scripts\setup.bat first.
    exit /b 1
)

.venv\Scripts\pip install -r requirements.txt --upgrade

.venv\Scripts\pyinstaller --onefile --clean --name spotify-jam-backend ^
  --add-data "app\schema.sql;app" ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols ^
  --hidden-import uvicorn.protocols.http ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.http.h11_impl ^
  --hidden-import uvicorn.protocols.http.httptools_impl ^
  --hidden-import uvicorn.protocols.websockets ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.protocols.websockets.wsproto_impl ^
  --hidden-import uvicorn.lifespan ^
  --hidden-import uvicorn.lifespan.on ^
  --hidden-import uvicorn.lifespan.off ^
  --collect-submodules uvicorn ^
  --collect-submodules fastapi ^
  --hidden-import httptools ^
  --hidden-import h11 ^
  --hidden-import httpx ^
  --hidden-import httpx._transports ^
  --hidden-import httpx._transports.default ^
  --hidden-import httpcore ^
  --hidden-import anyio ^
  --hidden-import anyio._backends ^
  --hidden-import anyio._backends._asyncio ^
  --hidden-import sniffio ^
  --hidden-import apscheduler.schedulers.asyncio ^
  --hidden-import apscheduler.triggers.interval ^
  --hidden-import apscheduler.triggers.cron ^
  --hidden-import apscheduler.triggers.date ^
  --collect-submodules apscheduler ^
  --hidden-import jose ^
  --hidden-import jose.backends ^
  --hidden-import jose.backends.cryptography_backend ^
  --hidden-import jose.jwk ^
  --hidden-import jose.jws ^
  --hidden-import jose.jwt ^
  --hidden-import zeroconf ^
  --hidden-import ifaddr ^
  --hidden-import argon2 ^
  --hidden-import argon2.low_level ^
  --hidden-import _argon2_cffi_bindings ^
  --hidden-import multipart ^
  --hidden-import multipart.multipart ^
  --hidden-import python_multipart ^
  --hidden-import keyring ^
  --hidden-import keyring.backends ^
  --hidden-import cryptography ^
  --hidden-import dotenv ^
  --hidden-import pydantic ^
  --hidden-import pydantic.deprecated ^
  --hidden-import pydantic.deprecated.decorator ^
  --collect-submodules pydantic ^
  --hidden-import starlette ^
  --collect-submodules starlette ^
  --hidden-import email_validator ^
  --hidden-import sqlite3 ^
  run.py

if errorlevel 1 (
    echo Build failed!
    exit /b 1
)

echo Built: backend\dist\spotify-jam-backend.exe
