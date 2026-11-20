# J_Platform third-party notices

This inventory describes third-party packages in the Windows desktop application. It is not legal clearance.

## Microsoft Build of OpenJDK

The application bundles Microsoft Build of OpenJDK 21.0.13.0.2+1 for Windows x64. The archive SHA-256 was recomputed as c5706a9cf482ef1a0622a86eea5b13d557b07f04554572af061e2d02b58c0f99 and matches the pinned runtime manifest. The distribution includes GPL version 2 with the Classpath Exception and OpenJDK Assembly Exception, module-specific legal notices, and src.zip. The full runtime legal tree is retained. See LICENSES/OpenJDK and docs/OPENJDK_REDISTRIBUTION.md.

The detached archive signature is present but has not been verified. Legal review of source correspondence and redistribution duties remains required.

## Electron, Chromium, and Node.js

The desktop shell includes Electron 45.2.1, its embedded Node.js runtime, and Chromium. Electron's LICENSE.electron.txt and Chromium's LICENSES.chromium.html are included in the current unpacked development package.

## JavaScript packages

LICENSES/NPM-PACKAGES.md records 98 production package entries collected from the locked production dependency trees. Available license and notice files are included under LICENSES/npm. The server runtime also retains upstream license files within package directories. Review the generated declared-license metadata for missing or unspecified items before public redistribution.

## Package verification

The Windows 11 development candidate's unpacked payload was inspected and includes LICENSES/NPM-PACKAGES.md, LICENSES/OpenJDK, LICENSES/npm, and THIRD_PARTY_NOTICES.md. The preserved historical installer lacked the generated LICENSES directory and this notice. The final signed production package is not built; repeat the payload check after signing and before submission.

## Review status

No legal clearance is claimed. A human or legal review must confirm OpenJDK source obligations and all bundled third-party licenses and attribution requirements.