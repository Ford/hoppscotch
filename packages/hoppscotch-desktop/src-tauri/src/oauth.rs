//! Captures an OAuth 2.0 authorization redirect in a dedicated login window.
//!
//! Used when an Authorization Code flow is configured with a custom callback
//! URL (e.g. one registered with the identity provider that Hoppscotch cannot
//! serve). The login page is opened in a separate webview and every
//! navigation is inspected; as soon as the webview tries to navigate to the
//! callback URL, the navigation is cancelled and the full URL (containing the
//! `code` and `state`) is returned to the frontend, which then performs the
//! token exchange.
//!
//! The login window loads a remote origin, which is not covered by any
//! capability, so it has no IPC access. Only the callback URL crosses back.

use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const DEFAULT_TIMEOUT_SECS: u64 = 300;
const MAX_TIMEOUT_SECS: u64 = 1800;

fn is_http_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Whether `candidate` points at the configured callback URL (same scheme,
/// host, port and path; query/fragment are ignored).
fn matches_redirect_uri(candidate: &Url, redirect_uri: &Url) -> bool {
    candidate.scheme() == redirect_uri.scheme()
        && candidate.host_str() == redirect_uri.host_str()
        && candidate.port_or_known_default() == redirect_uri.port_or_known_default()
        && candidate.path().trim_end_matches('/') == redirect_uri.path().trim_end_matches('/')
}

fn unique_window_label() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();

    format!("oauth-capture-{nanos}")
}

/// Opens `auth_url` in a new login window and resolves with the first URL the
/// window navigates to that matches `redirect_uri`.
///
/// Errors: `INVALID_AUTH_URL`, `INVALID_REDIRECT_URI`,
/// `WINDOW_CREATION_FAILED`, `WINDOW_CLOSED`, `TIMEOUT`.
#[tauri::command]
pub async fn oauth_capture_redirect(
    app: AppHandle,
    auth_url: String,
    redirect_uri: String,
    timeout_secs: Option<u64>,
) -> Result<String, String> {
    let auth_url = Url::parse(&auth_url)
        .ok()
        .filter(is_http_url)
        .ok_or_else(|| "INVALID_AUTH_URL".to_string())?;

    let redirect_uri = Url::parse(&redirect_uri)
        .ok()
        .filter(|url| url.host_str().is_some())
        .ok_or_else(|| "INVALID_REDIRECT_URI".to_string())?;

    let timeout = Duration::from_secs(
        timeout_secs
            .unwrap_or(DEFAULT_TIMEOUT_SECS)
            .clamp(1, MAX_TIMEOUT_SECS),
    );

    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(tx));

    let label = unique_window_label();

    let navigation_tx = Arc::clone(&tx);
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(auth_url))
        .title("Sign in")
        .inner_size(520.0, 720.0)
        .center()
        .focused(true)
        // Fresh, non-persistent session per login so provider cookies never
        // leak into (or out of) the main app webview.
        .incognito(true)
        .on_navigation(move |url| {
            if matches_redirect_uri(url, &redirect_uri) {
                if let Ok(sender) = navigation_tx.lock() {
                    let _ = sender.send(Ok(url.to_string()));
                }
                // The callback URL is usually not reachable (e.g. a local dev
                // server), so never actually load it.
                return false;
            }

            true
        })
        .build()
        .map_err(|e| {
            tracing::error!(error = %e, "Failed to create OAuth login window");
            "WINDOW_CREATION_FAILED".to_string()
        })?;

    let close_tx = Arc::clone(&tx);
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Ok(sender) = close_tx.lock() {
                let _ = sender.send(Err("WINDOW_CLOSED".to_string()));
            }
        }
    });

    // The first message wins: a captured redirect, the user closing the
    // window, or the timeout.
    let result = tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(_) => Err("TIMEOUT".to_string()),
    })
    .await
    .unwrap_or_else(|_| Err("TIMEOUT".to_string()));

    if let Some(window) = app.get_webview_window(&label) {
        if let Err(e) = window.destroy() {
            tracing::warn!(error = %e, "Failed to close OAuth login window");
        }
    }

    match &result {
        Ok(_) => tracing::info!("OAuth redirect captured"),
        Err(reason) => tracing::info!(reason = %reason, "OAuth redirect capture ended"),
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn matches_callback_with_query() {
        let redirect = url("https://localdev.example.com:8443/login/oauth2/code/b2c");
        assert!(matches_redirect_uri(
            &url("https://localdev.example.com:8443/login/oauth2/code/b2c?code=abc&state=x"),
            &redirect
        ));
    }

    #[test]
    fn ignores_trailing_slash_and_default_port() {
        let redirect = url("https://example.com/cb/");
        assert!(matches_redirect_uri(
            &url("https://example.com:443/cb?code=1"),
            &redirect
        ));
    }

    #[test]
    fn rejects_other_hosts_ports_and_paths() {
        let redirect = url("https://localdev.example.com:8443/cb");
        assert!(!matches_redirect_uri(
            &url("https://login.example.com/cb?code=1"),
            &redirect
        ));
        assert!(!matches_redirect_uri(
            &url("https://localdev.example.com/cb?code=1"),
            &redirect
        ));
        assert!(!matches_redirect_uri(
            &url("https://localdev.example.com:8443/cb2"),
            &redirect
        ));
        assert!(!matches_redirect_uri(
            &url("http://localdev.example.com:8443/cb"),
            &redirect
        ));
    }

    #[test]
    fn only_http_auth_urls_are_allowed() {
        assert!(is_http_url(&url("https://example.com")));
        assert!(!is_http_url(&url("file:///etc/passwd")));
        assert!(!is_http_url(&url("javascript:alert(1)")));
    }
}
