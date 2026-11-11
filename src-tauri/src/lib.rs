use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};

const UNAUTHORIZED: &str = "unauthorized";

/// Public Schedule of Classes. No login needed.
const SOC: &str = "https://sa.ucla.edu";
/// MyUCLA, behind SSO. Holds the Class Planner and the enrolled classes.
const MYUCLA: &str = "https://be.my.ucla.edu";
const PLANNER_PATH: &str = "/ClassPlanner/ClassPlan.aspx";
/// How many Schedule of Classes requests run at once when building the course index.
const INDEX_BATCH: usize = 16;

/// The MyUCLA session as a `Cookie` header. Comes from the login window or from Firefox.
struct Session(Mutex<String>);

fn on_myucla(url: &Url) -> bool {
    url.host_str() == Url::parse(MYUCLA).unwrap().host_str()
}

fn session_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("session"))
}

/// Makes `cookie` the active session and saves it, so the app stays signed in across restarts.
fn set_session(app: &AppHandle, cookie: String) -> Result<(), String> {
    let file = session_file(app)?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&file, &cookie).map_err(|e| e.to_string())?;
    // Session cookies are as good as a password; keep them readable by this user only.
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    *app.state::<Session>().0.lock().unwrap() = cookie;
    Ok(())
}

fn cookie_header<'a>(pairs: impl Iterator<Item = (&'a str, &'a str)>) -> String {
    pairs.map(|(name, value)| format!("{name}={value}")).collect::<Vec<_>>().join("; ")
}

/// Opens the Class Planner in its own window, which redirects through SSO.
/// Emits `logged-in` once the planner itself has loaded.
#[tauri::command]
fn login(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("login") {
        return existing.set_focus().map_err(|e| e.to_string());
    }
    let url: Url = format!("{MYUCLA}{PLANNER_PATH}").parse().unwrap();
    WebviewWindowBuilder::new(&app, "login", WebviewUrl::External(url))
        .title("Log in to MyUCLA")
        .inner_size(520.0, 720.0)
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished && on_myucla(payload.url()) {
                let w = window.clone();
                tauri::async_runtime::spawn(async move {
                    let saved = w
                        .cookies_for_url(MYUCLA.parse().unwrap())
                        .map_err(|e| e.to_string())
                        .and_then(|cookies| {
                            set_session(w.app_handle(), cookie_header(cookies.iter().map(|c| (c.name(), c.value()))))
                        });
                    if let Err(e) = saved {
                        eprintln!("saving session failed: {e}");
                    }
                    w.emit("logged-in", ()).unwrap();
                    w.close()
                });
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
struct FirefoxCookie {
    host: String,
    name: String,
    value: String,
}

#[derive(Deserialize)]
struct FirefoxSessionStore {
    #[serde(default)]
    cookies: Vec<FirefoxCookie>,
}

/// The profile Firefox opens by default, from the `[Install…]` section of profiles.ini.
fn firefox_profile(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app.path().home_dir().map_err(|e| e.to_string())?.join(".mozilla/firefox");
    let ini = std::fs::read_to_string(root.join("profiles.ini")).map_err(|e| format!("Firefox profiles.ini: {e}"))?;
    let mut in_install = false;
    for line in ini.lines() {
        if line.starts_with('[') {
            in_install = line.starts_with("[Install");
        } else if in_install && let Some(path) = line.strip_prefix("Default=") {
            return Ok(root.join(path));
        }
    }
    Err("Firefox has no default profile".into())
}

/// Takes over the MyUCLA session of the running Firefox. Session cookies never reach
/// cookies.sqlite; Firefox keeps them in its session store, an lz4 block behind a 12-byte header.
#[tauri::command]
fn firefox_session(app: AppHandle) -> Result<(), String> {
    let file = firefox_profile(&app)?.join("sessionstore-backups/recovery.jsonlz4");
    let raw = std::fs::read(&file).map_err(|e| format!("Firefox session store: {e}"))?;
    if raw.len() < 12 || &raw[..8] != b"mozLz40\0" {
        return Err("Firefox session store has an unknown format".into());
    }
    let size = u32::from_le_bytes(raw[8..12].try_into().unwrap()) as usize;
    let json = lz4_flex::block::decompress(&raw[12..], size).map_err(|e| e.to_string())?;
    let store: FirefoxSessionStore = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    let host = Url::parse(MYUCLA).unwrap().host_str().unwrap().to_string();
    let cookies: Vec<&FirefoxCookie> =
        store.cookies.iter().filter(|c| c.host == host || c.host == ".ucla.edu").collect();
    if !cookies.iter().any(|c| c.host == host) {
        return Err(UNAUTHORIZED.into());
    }
    set_session(&app, cookie_header(cookies.iter().map(|c| (c.name.as_str(), c.value.as_str()))))
}

/// Cache file for a response. `key` is a short name chosen by the frontend, since URLs here
/// carry long JSON queries that don't fit in a file name.
fn cache_file(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let name: String = key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    Ok(dir.join(name))
}

fn cache_write(app: &AppHandle, key: &str, body: &str) -> Result<(), String> {
    let file = cache_file(app, key)?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&file, body).map_err(|e| e.to_string())
}

async fn soc_fetch(client: &reqwest::Client, path: &str) -> Result<String, String> {
    let res = client
        .get(format!("{SOC}{path}"))
        .header("X-Requested-With", "XMLHttpRequest")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Schedule of Classes returned {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

/// GET a public Schedule of Classes path (with query). The body is HTML or JSON; the frontend parses it.
#[tauri::command]
async fn soc_get(
    app: AppHandle,
    client: State<'_, reqwest::Client>,
    key: String,
    path: String,
) -> Result<String, String> {
    let body = soc_fetch(&client, &path).await?;
    cache_write(&app, &key, &body)?;
    Ok(body)
}

/// GET many Schedule of Classes paths, a batch at a time. Returns a JSON object of name → body.
/// Used to index every subject's course list for search.
#[tauri::command]
async fn soc_get_many(
    app: AppHandle,
    client: State<'_, reqwest::Client>,
    key: String,
    paths: HashMap<String, String>,
) -> Result<String, String> {
    let entries: Vec<(String, String)> = paths.into_iter().collect();
    let mut bodies = serde_json::Map::new();
    for batch in entries.chunks(INDEX_BATCH) {
        let tasks: Vec<_> = batch
            .iter()
            .cloned()
            .map(|(name, path)| {
                let client = client.inner().clone();
                tauri::async_runtime::spawn(async move { soc_fetch(&client, &path).await.map(|body| (name, body)) })
            })
            .collect();
        for task in tasks {
            let (name, body) = task.await.map_err(|e| e.to_string())??;
            bodies.insert(name, body.into());
        }
    }
    let body = serde_json::Value::Object(bodies).to_string();
    cache_write(&app, &key, &body)?;
    Ok(body)
}

/// Sends a MyUCLA request with the session and returns the body. Signed out shows as a
/// redirect to the SSO host.
async fn myucla_send(session: &Session, request: reqwest::RequestBuilder) -> Result<String, String> {
    let cookie = session.0.lock().unwrap().clone();
    let res = request.header("Cookie", cookie).send().await.map_err(|e| e.to_string())?;
    if res.status() == reqwest::StatusCode::UNAUTHORIZED || !on_myucla(res.url()) {
        return Err(UNAUTHORIZED.into());
    }
    if !res.status().is_success() {
        return Err(format!("MyUCLA returned {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn myucla_get(
    client: State<'_, reqwest::Client>,
    session: State<'_, Session>,
    path: String,
) -> Result<String, String> {
    myucla_send(&session, client.get(format!("{MYUCLA}{path}"))).await
}

#[tauri::command]
async fn myucla_post(
    client: State<'_, reqwest::Client>,
    session: State<'_, Session>,
    path: String,
    body: String,
    content_type: String,
) -> Result<String, String> {
    let request = client.post(format!("{MYUCLA}{path}")).header("Content-Type", content_type).body(body);
    myucla_send(&session, request).await
}

/// Last cached response body for a key, or null if never fetched.
#[tauri::command]
fn cache_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let file = cache_file(&app, &key)?;
    if !file.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(file).map(Some).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // UCLA's firewall rejects requests without a browser-like User-Agent.
        .manage(
            reqwest::Client::builder()
                .user_agent("Mozilla/5.0 Planner/0.1")
                .build()
                .unwrap(),
        )
        .setup(|app| {
            let saved = session_file(app.handle()).ok().and_then(|f| std::fs::read_to_string(f).ok());
            app.manage(Session(Mutex::new(saved.unwrap_or_default())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            login,
            firefox_session,
            soc_get,
            soc_get_many,
            myucla_get,
            myucla_post,
            cache_get
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
