use sha2::{Digest, Sha256};
use std::{fs::File, path::Path};

use super::{IndexEntry, keys};

pub fn verify_archive(
    path: &Path,
    signature: &str,
    entry: &IndexEntry,
    pubkey: &str,
) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| format!("IO: {e}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = std::io::Read::read(&mut file, &mut buffer).map_err(|e| format!("IO: {e}"))?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    let actual = hash.finalize();
    let actual_hex = actual
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    if actual_hex != entry.sha256 {
        return Err("HASH_MISMATCH".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("IO: {e}"))?;
    if !keys::verify_detached(&bytes, signature, pubkey) {
        return Err("SIGNATURE_INVALID".into());
    }
    Ok(())
}

#[cfg(test)]
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
