//! Small secret-storage abstraction for keys that must never live in SQLite:
//! the device signing seed (phase 05) and assessment keys (phase 10).
//!
//! Production uses the OS keychain (Windows Credential Manager via `keyring`). Other platforms
//! return `IO: secure storage unavailable` until a store is configured for them.
//! Tests use [`MemorySecrets`] so they never touch the real keychain.
#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

pub const DEVICE_KEY: &str = "platform/device-key";

pub fn assessment_key_name(assessment_id: &str) -> String {
    format!("platform/assessment/{assessment_id}")
}

pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<String>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    #[allow(dead_code)] // used by the phase 10 assessment module
    fn delete(&self, name: &str) -> Result<(), String>;
}

/// Tauri-managed wrapper so commands can take `State<Secrets>`.
pub struct Secrets(pub Box<dyn SecretStore>);

#[cfg(target_os = "windows")]
const SERVICE: &str = "com.platform.student";

/// OS keychain store. Each secret is one credential entry under the app's service name.
pub struct KeyringSecrets;

impl SecretStore for KeyringSecrets {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        #[cfg(target_os = "windows")]
        {
            let entry = keyring::Entry::new(SERVICE, name)
                .map_err(|e| format!("IO: secure storage unavailable: {e}"))?;
            match entry.get_password() {
                Ok(v) => Ok(Some(v)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(format!("IO: secure storage read failed: {e}")),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = name;
            Err("IO: secure storage unavailable".into())
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            keyring::Entry::new(SERVICE, name)
                .and_then(|e| e.set_password(value))
                .map_err(|e| format!("IO: secure storage write failed: {e}"))
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (name, value);
            Err("IO: secure storage unavailable".into())
        }
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            let entry = keyring::Entry::new(SERVICE, name)
                .map_err(|e| format!("IO: secure storage unavailable: {e}"))?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("IO: secure storage delete failed: {e}")),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = name;
            Ok(())
        }
    }
}

/// In-memory store, used only by tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemorySecrets(Mutex<HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemorySecrets {
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "IO: lock".to_string())?
            .get(name)
            .cloned())
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "IO: lock".to_string())?
            .insert(name.into(), value.into());
        Ok(())
    }
    fn delete(&self, name: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "IO: lock".to_string())?
            .remove(name);
        Ok(())
    }
}
