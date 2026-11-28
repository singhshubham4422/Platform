use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};
use std::{fs, path::Path};

fn local_release_key(start: &Path) -> Option<String> {
    for dir in start.ancestors() {
        let candidate = dir.join(".local/keys/release.pub");
        if let Ok(value) = fs::read_to_string(candidate) {
            let value = value.trim().to_owned();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

pub fn release_public_key() -> Result<String, String> {
    release_public_key_from(
        option_env!("PLATFORM_RELEASE_PUBKEY"),
        if cfg!(any(debug_assertions, test)) {
            local_release_key(Path::new(env!("CARGO_MANIFEST_DIR")))
        } else {
            None
        },
    )
}

fn release_public_key_from(
    compiled: Option<&str>,
    local: Option<String>,
) -> Result<String, String> {
    if let Some(value) = compiled.filter(|v| !v.trim().is_empty()) {
        return Ok(value.trim().to_owned());
    }
    #[cfg(any(debug_assertions, test))]
    if let Some(value) = local {
        return Ok(value);
    }
    let _ = local;
    Err("PACK_KEY_NOT_CONFIGURED: release".into())
}

pub fn verify_detached(bytes: &[u8], sig_b64: &str, pubkey_b64: &str) -> bool {
    let Ok(key_bytes) = STANDARD.decode(pubkey_b64.trim()) else {
        return false;
    };
    let Ok(key_array) = <[u8; 32]>::try_from(key_bytes.as_slice()) else {
        return false;
    };
    let Ok(key) = VerifyingKey::from_bytes(&key_array) else {
        return false;
    };
    let Ok(sig_bytes) = STANDARD.decode(sig_b64.trim()) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(&sig_bytes) else {
        return false;
    };
    key.verify_strict(bytes, &signature).is_ok()
}

#[cfg(test)]
mod key_tests {
    use super::*;
    #[test]
    fn key_selection_is_compile_key_then_local_then_error() {
        assert_eq!(
            release_public_key_from(Some(" compiled "), Some("local".into())).unwrap(),
            "compiled"
        );
        assert_eq!(
            release_public_key_from(None, Some("local".into())).unwrap(),
            "local"
        );
        assert_eq!(
            release_public_key_from(None, None).unwrap_err(),
            "PACK_KEY_NOT_CONFIGURED: release"
        );
    }
    #[test]
    fn malformed_signatures_and_keys_fail_closed() {
        assert!(!verify_detached(b"x", "bad", "bad"));
        assert!(!verify_detached(
            b"x",
            &STANDARD.encode([0u8; 64]),
            &STANDARD.encode([0u8; 32])
        ));
    }
}
