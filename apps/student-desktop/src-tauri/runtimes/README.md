# Bundled runtimes

`node scripts/fetch-runtimes.mjs` fills this folder with portable toolchains for the current OS:

| Folder | Languages | Source |
| --- | --- | --- |
| `python/` | Python 3 | python-build-standalone (`install_only_stripped`) |
| `zig/` | C (`zig cc`) and C++ (`zig c++`) | ziglang.org release (bundled clang, libc headers and linker) |
| `java/` | Java | Eclipse Temurin JDK, reduced with `jlink` (includes `javac`) |

It also writes `manifest.json`, which the desktop app reads at startup. Tauri copies the whole
folder into the installer's resources, so students never install a compiler. Everything here
except this README is generated and ignored by git. Each download is checked against its
published SHA-256. Licenses ship inside each folder (`python/LICENSE*`, `zig/LICENSE`,
`java/legal/`).
