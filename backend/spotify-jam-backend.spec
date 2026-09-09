# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = ['uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.protocols.http.h11_impl', 'uvicorn.protocols.http.httptools_impl', 'uvicorn.protocols.websockets', 'uvicorn.protocols.websockets.auto', 'uvicorn.protocols.websockets.wsproto_impl', 'uvicorn.lifespan', 'uvicorn.lifespan.on', 'uvicorn.lifespan.off', 'httptools', 'h11', 'httpx', 'httpx._transports', 'httpx._transports.default', 'httpcore', 'anyio', 'anyio._backends', 'anyio._backends._asyncio', 'sniffio', 'apscheduler.schedulers.asyncio', 'apscheduler.triggers.interval', 'apscheduler.triggers.cron', 'apscheduler.triggers.date', 'jose', 'jose.backends', 'jose.backends.cryptography_backend', 'jose.jwk', 'jose.jws', 'jose.jwt', 'zeroconf', 'ifaddr', 'argon2', 'argon2.low_level', '_argon2_cffi_bindings', 'multipart', 'multipart.multipart', 'python_multipart', 'keyring', 'keyring.backends', 'cryptography', 'dotenv', 'pydantic', 'pydantic.deprecated', 'pydantic.deprecated.decorator', 'starlette', 'email_validator', 'sqlite3']
hiddenimports += collect_submodules('uvicorn')
hiddenimports += collect_submodules('fastapi')
hiddenimports += collect_submodules('apscheduler')
hiddenimports += collect_submodules('pydantic')
hiddenimports += collect_submodules('starlette')


a = Analysis(
    ['run.py'],
    pathex=[],
    binaries=[],
    datas=[('app/schema.sql', 'app')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='spotify-jam-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
