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

const WINDOW_LABEL_PREFIX: &str = "oauth-capture-";

/// Safety net: a window kept open after capture is closed after this long
/// even if the frontend never asks for it (e.g. it crashed mid-exchange).
const KEEP_OPEN_MAX_SECS: u64 = 120;

/// Shown in the login window while the frontend exchanges the code.
const COMPLETING_SCRIPT: &str = r#"(function () {
  try {
    document.title = "Completing sign-in";
    document.documentElement.innerHTML =
      '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#555;background:#fff">' +
      '<p style="font-size:15px">Completing sign-in&hellip; This window will close automatically.</p></body>';
  } catch (_) {}
})();"#;

fn unique_window_label() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();

    format!("{WINDOW_LABEL_PREFIX}{nanos}")
}

/// Only labels of windows created by this module may be supplied or closed.
fn is_capture_window_label(label: &str) -> bool {
    label.strip_prefix(WINDOW_LABEL_PREFIX).is_some_and(|rest| {
        !rest.is_empty()
            && rest.len() <= 64
            && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

fn destroy_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        if let Err(e) = window.destroy() {
            tracing::warn!(error = %e, "Failed to close OAuth login window");
        }
    }
}

/// Opens `auth_url` in a new login window and resolves with the first URL the
/// window navigates to that matches `redirect_uri`.
///
/// When `window_label` is supplied, the window stays open (showing a
/// "Completing sign-in" message) after a successful capture so the frontend
/// can finish the token exchange first and then call
/// `oauth_close_capture_window`. Otherwise it is closed immediately.
///
/// Errors: `INVALID_AUTH_URL`, `INVALID_REDIRECT_URI`, `INVALID_WINDOW_LABEL`,
/// `WINDOW_CREATION_FAILED`, `WINDOW_CLOSED`, `TIMEOUT`.
#[tauri::command]
pub async fn oauth_capture_redirect(
    app: AppHandle,
    auth_url: String,
    redirect_uri: String,
    timeout_secs: Option<u64>,
    window_label: Option<String>,
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

    let keep_open = window_label.is_some();
    let label = match window_label {
        Some(label) if is_capture_window_label(&label) => label,
        Some(_) => return Err("INVALID_WINDOW_LABEL".to_string()),
        None => unique_window_label(),
    };

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

    match (&result, keep_open) {
        (Ok(_), true) => {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.eval(COMPLETING_SCRIPT);
            }

            let app = app.clone();
            let label = label.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(KEEP_OPEN_MAX_SECS));
                destroy_window(&app, &label);
            });
        }
        _ => destroy_window(&app, &label),
    }

    match &result {
        Ok(_) => tracing::info!("OAuth redirect captured"),
        Err(reason) => tracing::info!(reason = %reason, "OAuth redirect capture ended"),
    }

    result
}

/// Closes a login window kept open by `oauth_capture_redirect`. No-op if it
/// is already gone.
#[tauri::command]
pub fn oauth_close_capture_window(app: AppHandle, window_label: String) -> Result<(), String> {
    if !is_capture_window_label(&window_label) {
        return Err("INVALID_WINDOW_LABEL".to_string());
    }

    destroy_window(&app, &window_label);
    Ok(())
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
    fn only_capture_window_labels_are_accepted() {
        assert!(is_capture_window_label("oauth-capture-123"));
        assert!(is_capture_window_label("oauth-capture-abc-DEF-9"));
        assert!(!is_capture_window_label("oauth-capture-"));
        assert!(!is_capture_window_label("main"));
        assert!(!is_capture_window_label("oauth-capture-../main"));
        assert!(!is_capture_window_label(&format!(
            "oauth-capture-{}",
            "a".repeat(65)
        )));
    }

    #[test]
    fn only_http_auth_urls_are_allowed() {
        assert!(is_http_url(&url("https://example.com")));
        assert!(!is_http_url(&url("file:///etc/passwd")));
        assert!(!is_http_url(&url("javascript:alert(1)")));
    }
}
