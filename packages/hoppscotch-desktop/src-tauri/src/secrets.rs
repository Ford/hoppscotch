//! Secure secret storage module using OS-level keychain services.
//!
//! This module provides a secure way to store sensitive data (passwords, tokens, API keys, etc.)
//! by leveraging the operating system's native secure storage mechanisms:
//!
//! - **macOS**: Keychain Services (encrypted with AES-256-GCM)
//! - **Windows**: Credential Manager (encrypted with DPAPI)
//! - **Linux**: Secret Service API (gnome-keyring, KWallet, etc.)
//!
//! ## Security Model
//!
//! 1. **Encryption at rest**: All secrets are encrypted by the OS using hardware-backed keys
//! 2. **User isolation**: Secrets are only accessible to the user who stored them
//! 3. **No plain-text storage**: Secrets never touch the filesystem in plain text
//! 4. **OS-managed**: Follows OS security policies (auto-lock, Touch ID, Windows Hello)
//!
//! ## Architecture
//!
//! ```text
//! Frontend (TypeScript)
//!     ↓ invoke('store_secret')
//! Tauri Command Layer (this file)
//!     ↓ keyring::Entry::set_password()
//! OS Keychain (native)
//!     ↓ Encrypted storage
//! Disk (encrypted by OS)
//! ```
//!
//! ## Usage Example (from TypeScript)
//!
//! ```typescript
//! // Store a secret
//! await invoke('store_secret', { key: 'oauth_client_secret', value: 'sk_live_123' });
//!
//! // Retrieve a secret
//! const secret = await invoke('get_secret', { key: 'oauth_client_secret' });
//!
//! // Delete a secret
//! await invoke('delete_secret', { key: 'oauth_client_secret' });
//!
//! // List all secret keys
//! const keys = await invoke('list_secret_keys');
//! ```

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::State;

/// Application-wide keyring service name.
/// This identifies all secrets as belonging to Hoppscotch Desktop.
const SERVICE_NAME: &str = "io.hoppscotch.desktop";

/// Thread-safe registry of all secret keys stored in the keychain.
/// We maintain this because the keyring crate doesn't provide a "list all" API.
#[derive(Default)]
pub struct SecretRegistry {
    /// Set of all secret keys that have been stored
    keys: Mutex<HashSet<String>>,
}

impl SecretRegistry {
    /// Initialize the registry by loading known keys from a special keychain entry
    pub fn new() -> Self {
        let registry = SecretRegistry::default();

        // Try to load existing keys from a special registry entry
        if let Ok(entry) = Entry::new(SERVICE_NAME, "__secret_registry__") {
            if let Ok(json) = entry.get_password() {
                if let Ok(keys) = serde_json::from_str::<HashSet<String>>(&json) {
                    let count = keys.len();
                    *registry.keys.lock().unwrap() = keys;
                    tracing::info!(count = count, "Loaded existing secret keys from registry");
                }
            }
        }

        registry
    }

    /// Add a key to the registry
    fn add(&self, key: String) {
        let mut keys = self.keys.lock().unwrap();
        keys.insert(key);
        self.persist(&keys);
    }

    /// Remove a key from the registry
    fn remove(&self, key: &str) {
        let mut keys = self.keys.lock().unwrap();
        keys.remove(key);
        self.persist(&keys);
    }

    /// Get all registered keys
    fn list(&self) -> Vec<String> {
        let keys = self.keys.lock().unwrap();
        keys.iter().cloned().collect()
    }

    /// Persist the registry to keychain
    fn persist(&self, keys: &HashSet<String>) {
        if let Ok(entry) = Entry::new(SERVICE_NAME, "__secret_registry__") {
            if let Ok(json) = serde_json::to_string(&keys) {
                let _ = entry.set_password(&json);
            }
        }
    }
}

/// Error type for secret operations
#[derive(Debug, Serialize, Deserialize)]
pub struct SecretError {
    pub message: String,
    pub code: String,
}

impl From<KeyringError> for SecretError {
    fn from(error: KeyringError) -> Self {
        let (message, code) = match error {
            KeyringError::NoEntry => (
                "Secret not found in keychain".to_string(),
                "SECRET_NOT_FOUND".to_string(),
            ),
            KeyringError::Ambiguous(_) => (
                "Multiple entries found (should not happen)".to_string(),
                "AMBIGUOUS_ENTRY".to_string(),
            ),
            KeyringError::PlatformFailure(e) => (
                format!("Platform keychain error: {}", e),
                "PLATFORM_ERROR".to_string(),
            ),
            _ => (
                format!("Keychain error: {:?}", error),
                "UNKNOWN_ERROR".to_string(),
            ),
        };

        tracing::error!(error.message = %message, error.code = %code, "Secret operation failed");

        SecretError { message, code }
    }
}

/// Store a secret in the OS keychain.
///
/// # Arguments
/// * `key` - Unique identifier for the secret (e.g., "oauth_client_secret", "cookie_session_token")
/// * `value` - The actual secret value to store (will be encrypted by OS)
///
/// # Returns
/// * `Ok(())` if successful
/// * `Err(SecretError)` if keychain access fails
///
/// # Security
/// - The value is immediately encrypted by the OS
/// - Only accessible by the current user
/// - Never written to disk in plain text
///
/// # Example Flow
/// 1. Frontend calls: `invoke('store_secret', { key: 'api_key', value: 'abc123' })`
/// 2. This function creates a keychain entry at: `io.hoppscotch.desktop/api_key`
/// 3. OS encrypts 'abc123' and stores it
/// 4. Key 'api_key' is added to the registry for listing
#[tauri::command]
pub async fn store_secret(
    key: String,
    value: String,
    registry: State<'_, SecretRegistry>,
) -> Result<(), SecretError> {
    tracing::debug!(key = %key, value_length = value.len(), "Storing secret");

    // Create a keychain entry for this specific key
    let entry = Entry::new(SERVICE_NAME, &key)?;

    // Store the value (OS will encrypt it)
    entry.set_password(&value)?;

    // Add to registry so we can list it later
    registry.add(key.clone());

    tracing::info!(key = %key, "Secret stored successfully");

    Ok(())
}

/// Retrieve a secret from the OS keychain.
///
/// # Arguments
/// * `key` - The unique identifier used when storing the secret
///
/// # Returns
/// * `Ok(String)` with the decrypted secret value
/// * `Err(SecretError)` if secret not found or keychain access fails
///
/// # Security
/// - OS decrypts the value in memory
/// - Value exists in memory only during this function call
/// - Consider using SecureString for longer-lived secrets
///
/// # Example Flow
/// 1. Frontend calls: `invoke('get_secret', { key: 'api_key' })`
/// 2. This function reads from keychain entry: `io.hoppscotch.desktop/api_key`
/// 3. OS decrypts the value and returns it
/// 4. Value is returned to frontend
#[tauri::command]
pub async fn get_secret(key: String) -> Result<String, SecretError> {
    tracing::debug!(key = %key, "Retrieving secret");

    // Access the keychain entry
    let entry = Entry::new(SERVICE_NAME, &key)?;

    // Get the value (OS will decrypt it)
    let value = entry.get_password()?;

    tracing::info!(key = %key, value_length = value.len(), "Secret retrieved successfully");

    Ok(value)
}

/// Delete a secret from the OS keychain.
///
/// # Arguments
/// * `key` - The unique identifier of the secret to delete
///
/// # Returns
/// * `Ok(())` if successful (or if secret didn't exist)
/// * `Err(SecretError)` if keychain access fails
///
/// # Security
/// - Secret is permanently removed from keychain
/// - Cannot be recovered after deletion
/// - OS may overwrite the encrypted data
///
/// # Example Flow
/// 1. Frontend calls: `invoke('delete_secret', { key: 'api_key' })`
/// 2. This function deletes keychain entry: `io.hoppscotch.desktop/api_key`
/// 3. Key 'api_key' is removed from the registry
#[tauri::command]
pub async fn delete_secret(
    key: String,
    registry: State<'_, SecretRegistry>,
) -> Result<(), SecretError> {
    tracing::debug!(key = %key, "Deleting secret");

    // Access the keychain entry
    let entry = Entry::new(SERVICE_NAME, &key)?;

    // Delete it (ignore error if it doesn't exist)
    match entry.delete_password() {
        Ok(()) => {
            registry.remove(&key);
            tracing::info!(key = %key, "Secret deleted successfully");
            Ok(())
        }
        Err(KeyringError::NoEntry) => {
            // Already deleted or never existed - not an error
            registry.remove(&key);
            tracing::info!(key = %key, "Secret already deleted or not found");
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// List all secret keys stored by Hoppscotch.
///
/// # Returns
/// * `Ok(Vec<String>)` with all registered secret keys
///
/// # Note
/// - Returns only the keys, not the values
/// - Keys are stored in a special registry entry in the keychain
/// - If registry is corrupted, may return incomplete list
///
/// # Example Flow
/// 1. Frontend calls: `invoke('list_secret_keys')`
/// 2. This function reads from registry: `io.hoppscotch.desktop/__secret_registry__`
/// 3. Returns array like: `["api_key", "oauth_client_secret", "cookie_session"]`
#[tauri::command]
pub async fn list_secret_keys(registry: State<'_, SecretRegistry>) -> Result<Vec<String>, SecretError> {
    let keys = registry.list();
    tracing::info!(count = keys.len(), "Listed secret keys");
    Ok(keys)
}

/// Check if a specific secret exists in the keychain.
///
/// # Arguments
/// * `key` - The unique identifier to check
///
/// # Returns
/// * `Ok(true)` if secret exists
/// * `Ok(false)` if secret doesn't exist
/// * `Err(SecretError)` if keychain access fails
///
/// # Example Flow
/// 1. Frontend calls: `invoke('has_secret', { key: 'api_key' })`
/// 2. This function tries to read from: `io.hoppscotch.desktop/api_key`
/// 3. Returns true if found, false if not found
#[tauri::command]
pub async fn has_secret(key: String) -> Result<bool, SecretError> {
    let entry = Entry::new(SERVICE_NAME, &key)?;

    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_store_and_retrieve_secret() {
        let registry = SecretRegistry::new();
        let test_key = format!("test_key_{}", uuid::Uuid::new_v4());
        let test_value = "super_secret_value_123";

        // Store
        let result = store_secret(test_key.clone(), test_value.to_string(), State::from(&registry)).await;
        assert!(result.is_ok());

        // Retrieve
        let result = get_secret(test_key.clone()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), test_value);

        // Clean up
        let _ = delete_secret(test_key, State::from(&registry)).await;
    }
}
