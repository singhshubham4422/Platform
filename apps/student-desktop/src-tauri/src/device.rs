//! Device identity (C7 `device` row) and the monotonic counter (C10 `seq`, C7 `monotonic_seq`).
//!
//! - `device_id` and the Ed25519 public key live in SQLite; the private seed lives only in the
//!   [`SecretStore`] under [`DEVICE_KEY`].
//! - If the secret store is unavailable (non-Windows without a configured store), the device
//!   still gets an id and counter, but `public_key` is empty and nothing is signed. Unsigned
//!   attempts are fine for practice; the server rejects them for assessments.
//! - If the stored seed is lost (keychain wiped) a NEW device id and key are created and the
//!   counter continues, so the server never sees a changed key for an existing device id.
use crate::secrets::{DEVICE_KEY, SecretStore};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::{Signer, SigningKey};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub device_id: String,
    pub public_key: String,
    pub monotonic_seq: i64,
}

fn load(conn: &Connection) -> rusqlite::Result<Option<DeviceInfo>> {
    conn.query_row(
        "SELECT device_id, public_key, monotonic_seq FROM device WHERE id = 1",
        [],
        |r| {
            Ok(DeviceInfo {
                device_id: r.get(0)?,
                public_key: r.get(1)?,
                monotonic_seq: r.get(2)?,
            })
        },
    )
    .optional()
}

fn new_key() -> SigningKey {
    SigningKey::generate(&mut rand::rngs::OsRng)
}

/// Returns the device row, creating or repairing it as described in the module docs.
pub fn ensure(conn: &Connection, secrets: &dyn SecretStore) -> Result<DeviceInfo, String> {
    let existing = load(conn).map_err(|e| format!("IO: {e}"))?;
    let stored_seed = secrets.get(DEVICE_KEY);
    match (&existing, &stored_seed) {
        // Healthy: row exists and (key present, or storage unavailable and row has no key).
        (Some(d), Ok(Some(_))) if !d.public_key.is_empty() => return Ok(d.clone()),
        (Some(d), Err(_)) if d.public_key.is_empty() => return Ok(d.clone()),
        _ => {}
    }
    let seq = existing.as_ref().map_or(0, |d| d.monotonic_seq);
    let device_id = uuid::Uuid::new_v4().to_string();
    let public_key = match stored_seed {
        Ok(_) => {
            let key = new_key();
            secrets.set(DEVICE_KEY, &B64.encode(key.to_bytes()))?;
            B64.encode(key.verifying_key().to_bytes())
        }
        Err(_) => String::new(),
    };
    conn.execute(
        "INSERT INTO device (id, device_id, public_key, monotonic_seq) VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id, public_key = excluded.public_key",
        params![device_id, public_key, seq],
    )
    .map_err(|e| format!("IO: {e}"))?;
    Ok(DeviceInfo {
        device_id,
        public_key,
        monotonic_seq: seq,
    })
}

/// Increments and returns the counter inside the caller's transaction, so a value is never
/// reused even if the process crashes after the row that uses it is written.
pub fn next_seq(tx: &Transaction) -> rusqlite::Result<i64> {
    tx.query_row(
        "UPDATE device SET monotonic_seq = monotonic_seq + 1 WHERE id = 1 RETURNING monotonic_seq",
        [],
        |r| r.get(0),
    )
}

/// Signs `bytes` with the device seed. `None` when no key is available.
pub fn sign(secrets: &dyn SecretStore, bytes: &[u8]) -> Option<String> {
    let seed = secrets.get(DEVICE_KEY).ok()??;
    let raw: [u8; 32] = B64.decode(seed).ok()?.try_into().ok()?;
    Some(B64.encode(SigningKey::from_bytes(&raw).sign(bytes).to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use crate::store;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    struct NoSecrets;
    impl SecretStore for NoSecrets {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            Err("IO: secure storage unavailable".into())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Err("IO: secure storage unavailable".into())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
    }

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        store::migrate(&mut c).unwrap();
        c
    }

    #[test]
    fn creates_device_once_and_signs_verifiably() {
        let c = db();
        let s = MemorySecrets::default();
        let a = ensure(&c, &s).unwrap();
        let b = ensure(&c, &s).unwrap();
        assert_eq!(a, b);
        assert!(!a.public_key.is_empty());
        let sig = sign(&s, b"hello").unwrap();
        let pk: [u8; 32] = B64.decode(&a.public_key).unwrap().try_into().unwrap();
        let sig: [u8; 64] = B64.decode(sig).unwrap().try_into().unwrap();
        VerifyingKey::from_bytes(&pk)
            .unwrap()
            .verify(b"hello", &Signature::from_bytes(&sig))
            .unwrap();
    }

    #[test]
    fn lost_key_rotates_device_id_and_keeps_counter() {
        let mut c = db();
        let s = MemorySecrets::default();
        let first = ensure(&c, &s).unwrap();
        let tx = c.transaction().unwrap();
        assert_eq!(next_seq(&tx).unwrap(), 1);
        assert_eq!(next_seq(&tx).unwrap(), 2);
        tx.commit().unwrap();
        s.delete(DEVICE_KEY).unwrap();
        let second = ensure(&c, &s).unwrap();
        assert_ne!(first.device_id, second.device_id);
        assert_ne!(first.public_key, second.public_key);
        assert_eq!(second.monotonic_seq, 2);
    }

    #[test]
    fn counter_survives_reopen_and_rolled_back_values_are_not_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let s = MemorySecrets::default();
        {
            let mut c = store::open(&path).unwrap();
            ensure(&c, &s).unwrap();
            let tx = c.transaction().unwrap();
            assert_eq!(next_seq(&tx).unwrap(), 1);
            tx.commit().unwrap();
            // Simulated crash: transaction dropped without commit.
            let tx = c.transaction().unwrap();
            assert_eq!(next_seq(&tx).unwrap(), 2);
            drop(tx);
        }
        let mut c = store::open(&path).unwrap();
        assert_eq!(ensure(&c, &s).unwrap().monotonic_seq, 1);
        let tx = c.transaction().unwrap();
        // 2 was never committed, so no committed row can carry it; the next value is 2.
        assert_eq!(next_seq(&tx).unwrap(), 2);
    }

    #[test]
    fn unavailable_secret_store_gives_unsigned_device() {
        let c = db();
        let d = ensure(&c, &NoSecrets).unwrap();
        assert!(d.public_key.is_empty());
        assert_eq!(sign(&NoSecrets, b"x"), None);
        assert_eq!(ensure(&c, &NoSecrets).unwrap(), d);
    }
}
