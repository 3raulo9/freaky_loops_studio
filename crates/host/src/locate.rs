//! Finding what an imported project refers to — samples and plugins — even
//! when it was made on another machine, with different drive letters, or with
//! paths written relative to an app's data folder (`%SomeRoot%\Packs\…`).
//!
//! Order of attempts for a sample:
//!   1. the stored path as-is;
//!   2. next to the project file (and in its sub-folders);
//!   3. a file index of the usual places (home folders, Program Files, other
//!      drives), matching by file name and ranking by how many trailing path
//!      components agree with the stored path.
//! Plugins: the stored path, then the index by file name, then by plugin
//! name; every candidate must export a VST2 or VST3 entry point before it's
//! offered. The format the project used wins; the other format of the same
//! plugin is the fallback (it loads, but starts from its default sound).
//!
//! The index lists only audio and plugin files, is built by several threads,
//! and is cached in %APPDATA%\FreakyLoopsStudio\file-index.txt so later
//! imports resolve in milliseconds; a stale cache is refreshed in the
//! background and a fresh walk runs only when something is still missing.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

const AUDIO: [&str; 9] = ["wav", "mp3", "ogg", "flac", "aif", "aiff", "wv", "m4a", "sf2"];
const PLUGIN: [&str; 2] = ["dll", "vst3"];
const MAX_DEPTH: usize = 10;
const MAX_FILES: usize = 3_000_000;
const STALE_AFTER: Duration = Duration::from_secs(6 * 3600);

/// Lower-case file name → full paths.
#[derive(Default)]
struct FileIndex {
    by_name: HashMap<String, Vec<PathBuf>>,
}

impl FileIndex {
    fn insert(&mut self, p: PathBuf) {
        if let Some(n) = p.file_name().map(|n| n.to_string_lossy().to_lowercase()) {
            self.by_name.entry(n).or_default().push(p);
        }
    }
}

static INDEX: OnceLock<Mutex<Option<Arc<FileIndex>>>> = OnceLock::new();
static ALLOWED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn index_slot() -> &'static Mutex<Option<Arc<FileIndex>>> {
    INDEX.get_or_init(|| Mutex::new(None))
}

/// Files the UI may read through `/__file/` (things the user opened or the
/// resolver found) — nothing else on disk is reachable from the webview.
pub fn allow(p: &Path) {
    if let Ok(mut s) = ALLOWED.get_or_init(Default::default).lock() {
        s.insert(norm(p));
    }
}

pub fn is_allowed(p: &Path) -> bool {
    ALLOWED.get_or_init(Default::default).lock().map(|s| s.contains(&norm(p))).unwrap_or(false)
}

fn norm(p: &Path) -> PathBuf {
    PathBuf::from(p.to_string_lossy().replace('/', "\\").to_lowercase())
}

fn cache_path() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = base.join("FreakyLoopsStudio");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("file-index.txt")
}

fn wanted(p: &Path) -> bool {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    AUDIO.contains(&ext.as_str()) || PLUGIN.contains(&ext.as_str())
}

fn skip_dir(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with('$')
        || n.starts_with('.')
        || matches!(
            n.as_str(),
            "windows" | "system volume information" | "appdata" | "node_modules" | "target" | "temp" | "tmp" | "cache" | "caches"
                | "windowsapps" | "microsoft" | "microsoft office" | "windows defender" | "windows nt" | "common files\\microsoft shared"
                | "recovery" | "perflogs" | "msocache" | "intel" | "nvidia corporation" | "amd" | "programdata" | "__pycache__" | "site-packages"
        )
}

/// Per-user plugin install folders (variable, sub-folder).
const USER_PLUGIN_DIRS: [(&str, &str); 3] = [
    ("LOCALAPPDATA", "Programs\\Common\\VST3"),
    ("LOCALAPPDATA", "Programs\\Common\\VST2"),
    ("LOCALAPPDATA", "Programs\\Common\\CLAP"),
];

/// Folders plugins are installed to, as opposed to copies in build or download folders.
fn in_install_folder(p: &Path) -> bool {
    let s = p.to_string_lossy().to_lowercase();
    ["\\common files\\vst", "\\vstplugins\\", "\\programs\\common\\vst", "\\steinberg\\vst"].iter().any(|k| s.contains(k))
}

/// Places worth indexing: the user's folders, program folders, other drives.
fn roots() -> Vec<PathBuf> {
    let mut r: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        for sub in ["Desktop", "Documents", "Downloads", "Music", "OneDrive", "Splice"] {
            r.push(home.join(sub));
        }
    }
    for v in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(p) = std::env::var_os(v).map(PathBuf::from) {
            r.push(p);
        }
    }
    // Per-user plugin folders live under AppData, which the walk otherwise skips.
    for (var, sub) in USER_PLUGIN_DIRS {
        if let Some(p) = std::env::var_os(var).map(PathBuf::from) {
            r.push(p.join(sub));
        }
    }
    for extra in crate::files::setting("searchFolders").and_then(|v| v.as_array().cloned()).unwrap_or_default() {
        if let Some(s) = extra.as_str() {
            r.push(PathBuf::from(s));
        }
    }
    let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
    for letter in b'C'..=b'Z' {
        let d = format!("{}:", letter as char);
        if d != sys && Path::new(&format!("{d}\\")).is_dir() {
            r.push(PathBuf::from(format!("{d}\\")));
        }
    }
    let mut seen = HashSet::new();
    r.retain(|p| p.is_dir() && seen.insert(norm(p)));
    r
}

/// Walk `roots` with a small thread pool.
fn walk(roots: Vec<PathBuf>) -> FileIndex {
    let queue: Arc<Mutex<Vec<(PathBuf, usize)>>> = Arc::new(Mutex::new(roots.into_iter().map(|r| (r, 0)).collect()));
    let busy = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let found: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 12);
    let handles: Vec<_> = (0..threads)
        .map(|_| {
            let (queue, busy, found) = (queue.clone(), busy.clone(), found.clone());
            std::thread::spawn(move || {
                use std::sync::atomic::Ordering::SeqCst;
                let mut local: Vec<PathBuf> = Vec::new();
                loop {
                    let job = {
                        let mut q = queue.lock().unwrap();
                        let j = q.pop();
                        if j.is_some() {
                            busy.fetch_add(1, SeqCst);
                        }
                        j
                    };
                    let Some((dir, depth)) = job else {
                        if busy.load(SeqCst) == 0 {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    };
                    let mut subdirs = Vec::new();
                    if let Ok(rd) = std::fs::read_dir(&dir) {
                        for e in rd.flatten() {
                            let Ok(ft) = e.file_type() else { continue };
                            let p = e.path();
                            if ft.is_dir() {
                                // .vst3 bundles are folders; index the bundle itself.
                                if p.extension().map_or(false, |x| x.eq_ignore_ascii_case("vst3")) {
                                    local.push(p);
                                } else if depth < MAX_DEPTH && !skip_dir(&e.file_name().to_string_lossy()) {
                                    subdirs.push((p, depth + 1));
                                }
                            } else if wanted(&p) {
                                local.push(p);
                            }
                        }
                    }
                    if !subdirs.is_empty() {
                        queue.lock().unwrap().extend(subdirs);
                    }
                    if local.len() > 4096 {
                        let mut f = found.lock().unwrap();
                        if f.len() < MAX_FILES {
                            f.append(&mut local);
                        } else {
                            local.clear();
                        }
                    }
                    busy.fetch_sub(1, SeqCst);
                }
                found.lock().unwrap().append(&mut local);
            })
        })
        .collect();
    for h in handles {
        let _ = h.join();
    }
    let mut idx = FileIndex::default();
    for p in std::mem::take(&mut *found.lock().unwrap()) {
        idx.insert(p);
    }
    idx
}

/// First line of the cache; bumped when the set of searched folders changes.
const CACHE_HEADER: &str = "#fls-index 2";

fn save_cache(idx: &FileIndex) {
    let mut s = String::from(CACHE_HEADER);
    s.push('\n');
    for paths in idx.by_name.values() {
        for p in paths {
            s.push_str(&p.to_string_lossy());
            s.push('\n');
        }
    }
    let _ = std::fs::write(cache_path(), s);
}

fn load_cache() -> Option<(FileIndex, bool)> {
    let path = cache_path();
    let age = std::fs::metadata(&path).and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok())?;
    let text = std::fs::read_to_string(&path).ok()?;
    let mut lines = text.lines();
    if lines.next() != Some(CACHE_HEADER) {
        return None;
    }
    let mut idx = FileIndex::default();
    for line in lines.filter(|l| !l.is_empty()) {
        idx.insert(PathBuf::from(line));
    }
    Some((idx, age > STALE_AFTER))
}

/// How long ago the index on disk was written.
fn index_age() -> Duration {
    std::fs::metadata(cache_path()).and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok()).unwrap_or(Duration::MAX)
}

fn rebuild() -> Arc<FileIndex> {
    let t = std::time::Instant::now();
    let idx = Arc::new(walk(roots()));
    save_cache(&idx);
    fls_native::log::write(&format!("[locate] indexed {} names in {:.1}s", idx.by_name.len(), t.elapsed().as_secs_f32()));
    *index_slot().lock().unwrap() = Some(idx.clone());
    idx
}

/// The index, from memory, the disk cache, or a fresh walk (second value:
/// whether it was just walked, so a miss isn't worth walking again).
fn index(force_fresh: bool) -> (Arc<FileIndex>, bool) {
    if !force_fresh {
        if let Some(i) = index_slot().lock().unwrap().clone() {
            return (i, false);
        }
        if let Some((idx, stale)) = load_cache() {
            let idx = Arc::new(idx);
            *index_slot().lock().unwrap() = Some(idx.clone());
            if stale {
                std::thread::spawn(rebuild);
            }
            return (idx, false);
        }
    }
    (rebuild(), true)
}

/// Warm the index in the background (called at startup) so the first import is fast.
pub fn prewarm() {
    std::thread::spawn(|| {
        let _ = index(false);
    });
}

/// Path components of a stored path, dropping drive letters and `%Root%` placeholders.
fn components(stored: &str) -> Vec<String> {
    stored
        .split(['\\', '/'])
        .filter(|c| !c.is_empty() && !c.ends_with(':') && !(c.starts_with('%') && c.ends_with('%')))
        .map(|c| c.to_lowercase())
        .collect()
}

/// How many trailing components two paths share (file name included).
fn suffix_score(stored: &[String], cand: &Path) -> usize {
    let c: Vec<String> = cand.components().map(|x| x.as_os_str().to_string_lossy().to_lowercase()).collect();
    stored.iter().rev().zip(c.iter().rev()).take_while(|(a, b)| a == b).count()
}

fn best<'a>(stored: &str, cands: impl Iterator<Item = &'a PathBuf>) -> Option<PathBuf> {
    let comps = components(stored);
    cands
        .filter(|p| p.exists())
        .map(|p| (suffix_score(&comps, p), std::cmp::Reverse(p.as_os_str().len()), p))
        .max_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)))
        .map(|(_, _, p)| p.clone())
}

fn file_name_lower(stored: &str) -> String {
    stored.rsplit(['\\', '/']).next().unwrap_or(stored).trim().to_lowercase()
}

/// Shallow index of the project's own folder (shared projects keep samples beside the file).
fn project_index(dir: &Path) -> FileIndex {
    let mut idx = FileIndex::default();
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    let mut n = 0;
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            n += 1;
            if n > 200_000 {
                return idx;
            }
            let p = e.path();
            match e.file_type() {
                Ok(t) if t.is_dir() && depth < 5 => stack.push((p, depth + 1)),
                Ok(t) if t.is_file() && wanted(&p) => idx.insert(p),
                _ => {}
            }
        }
    }
    idx
}

fn normalize_name(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Remember a folder the user pointed at, so later imports (and index
/// rebuilds) search it too.
fn remember_folder(dir: &Path) {
    let mut list: Vec<Value> = crate::files::setting("searchFolders").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    let s = dir.to_string_lossy().to_string();
    if !list.iter().any(|v| v.as_str().map_or(false, |x| x.eq_ignore_ascii_case(&s))) {
        list.push(json!(s));
        crate::files::set_setting("searchFolders", Value::Array(list));
    }
}

/// `resolveAssets` request: `{ project?, folders?, samples: [path], plugins: [{ name, path, vendor }] }`.
/// Reply: `{ samples: { stored: found|null }, plugins: [{ path, arch, how } | null], indexed }`.
pub fn resolve(p: &Value) -> Value {
    let t = std::time::Instant::now();
    let project_dir = p.get("project").and_then(Value::as_str).filter(|s| !s.is_empty()).map(|s| Path::new(s).parent().map(Path::to_path_buf)).flatten();
    let samples: Vec<String> = p.get("samples").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let plugins: Vec<Value> = p.get("plugins").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut found: HashMap<String, Option<PathBuf>> = HashMap::new();
    // The project's folder, plus any folders the user pointed at, are searched first.
    let mut local = project_dir.as_deref().map(project_index).unwrap_or_default();
    for f in p.get("folders").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        let dir = PathBuf::from(f);
        if dir.is_dir() {
            for (k, v) in project_index(&dir).by_name {
                local.by_name.entry(k).or_default().extend(v);
            }
            remember_folder(&dir);
        }
    }
    let pointed = p.get("folders").and_then(Value::as_array).map_or(false, |a| !a.is_empty());
    let proj_idx = Some(local);
    for s in &samples {
        let direct = PathBuf::from(s.replace('/', "\\"));
        let hit = if !s.contains('%') && direct.is_file() {
            Some(direct)
        } else {
            proj_idx.as_ref().and_then(|pi| pi.by_name.get(&file_name_lower(s)).and_then(|c| best(s, c.iter())))
        };
        found.insert(s.clone(), hit);
    }

    // Plugins: the stored path first.
    let mut plug_hits: Vec<Option<(PathBuf, &'static str)>> = plugins
        .iter()
        .map(|q| {
            let path = q.get("path").and_then(Value::as_str).unwrap_or("");
            let pb = PathBuf::from(path.trim_end_matches(['\\', '/']));
            (!path.is_empty() && is_plugin(&pb)).then_some((pb, "original location"))
        })
        .collect();

    // Name-only plugin lookups (built-in generators that may have a VST build)
    // are optional: not finding one is normal and never worth a disk walk.
    let optional: Vec<bool> = plugins.iter().map(|q| q.get("path").and_then(Value::as_str).unwrap_or("").is_empty()).collect();
    let missing = |found: &HashMap<String, Option<PathBuf>>, plug: &[Option<(PathBuf, &'static str)>]| {
        found.values().any(Option::is_none) || plug.iter().zip(&optional).any(|(h, &opt)| h.is_none() && !opt)
    };
    let mut fresh = false;
    // Anything unresolved is looked up in the index; only required things
    // (samples, plugins with a stored path) are worth a fresh walk.
    let unresolved = found.values().any(Option::is_none) || plug_hits.iter().any(Option::is_none);
    if unresolved {
        let (mut idx, walked) = index(false);
        fresh = walked;
        loop {
            for (s, hit) in found.iter_mut().filter(|(_, h)| h.is_none()) {
                if let Some(c) = idx.by_name.get(&file_name_lower(s)) {
                    *hit = best(s, c.iter());
                }
            }
            for (q, hit) in plugins.iter().zip(plug_hits.iter_mut()).filter(|(_, h)| h.is_none()) {
                *hit = find_plugin(&idx, q);
            }
            // Still missing with an older index → the files may be new: walk again once.
            // (Not when the user pointed at a folder: that search is the answer.)
            if fresh || pointed || !missing(&found, &plug_hits) || index_age() < Duration::from_secs(60) {
                break;
            }
            idx = index(true).0;
            fresh = true;
        }
    }

    let mut out_samples = serde_json::Map::new();
    for (s, hit) in &found {
        if let Some(h) = hit {
            allow(h);
        }
        out_samples.insert(s.clone(), hit.as_ref().map_or(Value::Null, |h| json!(h.to_string_lossy())));
    }
    let out_plugins: Vec<Value> = plug_hits
        .into_iter()
        .map(|h| match h {
            Some((p, how)) => json!({
                "path": p.to_string_lossy(), "how": how,
                "arch": match plugin_arch(&p) { fls_native::pe::Arch::X86 => "x86", fls_native::pe::Arch::X64 => "x64", fls_native::pe::Arch::Arm64 => "arm64", _ => "unknown" },
                "format": if is_vst3_name(&p) { "vst3" } else { "vst2" },
            }),
            None => Value::Null,
        })
        .collect();
    let ms = t.elapsed().as_millis() as u64;
    fls_native::log::write(&format!("[locate] {} samples, {} plugins in {ms} ms (fresh walk: {fresh})", samples.len(), plugins.len()));
    json!({ "samples": out_samples, "plugins": out_plugins, "ms": ms, "freshWalk": fresh })
}

fn is_vst3_name(p: &Path) -> bool {
    p.extension().map_or(false, |e| e.eq_ignore_ascii_case("vst3"))
}

/// A loadable plugin: a VST2 DLL, or a VST3 bundle/file with a factory.
fn is_plugin(p: &Path) -> bool {
    if is_vst3_name(p) {
        fls_native::vst3::is_vst3(p)
    } else {
        p.extension().map_or(false, |e| e.eq_ignore_ascii_case("dll")) && p.is_file() && fls_native::pe::is_vst2(p)
    }
}

fn plugin_arch(p: &Path) -> fls_native::pe::Arch {
    let bin = if is_vst3_name(p) { fls_native::vst3::module_path(&p.to_string_lossy()) } else { Some(p.to_path_buf()) };
    bin.map_or(fls_native::pe::Arch::Unknown, |b| fls_native::pe::detect(&b.to_string_lossy()))
}

fn find_plugin(idx: &FileIndex, q: &Value) -> Option<(PathBuf, &'static str)> {
    let path = q.get("path").and_then(Value::as_str).unwrap_or("").trim_end_matches(['\\', '/']);
    let name = q.get("name").and_then(Value::as_str).unwrap_or("");
    let want_vst3 = q.get("format").and_then(Value::as_str) == Some("vst3") || is_vst3_name(Path::new(path));
    let x64 = |p: &PathBuf| plugin_arch(p) == fls_native::pe::Arch::X64;
    // Same file name as the stored path (moved install, other drive).
    if !path.is_empty() {
        if let Some(c) = idx.by_name.get(&file_name_lower(path)) {
            let comps = components(path);
            let mut v: Vec<&PathBuf> = c.iter().filter(|p| is_plugin(p)).collect();
            // Prefer 64-bit builds, then the closest folder structure, then installed copies.
            v.sort_by_key(|p| (!x64(p), std::cmp::Reverse(suffix_score(&comps, p)), !in_install_folder(p)));
            if let Some(p) = v.first() {
                return Some(((*p).clone(), "same file elsewhere"));
            }
        }
    }
    // By plugin name: "<name>.dll" / "<name>.vst3", matched ignoring punctuation.
    // Same format first; a 32-bit VST3 can't load, so it never qualifies.
    // A built-in generator's name often carries an edition word the VST build
    // lacks ("Name FL" → "Name"), so those also try the name without it.
    let mut names = vec![name.to_string()];
    if path.is_empty() {
        if let Some((head, _)) = name.trim().rsplit_once(' ') {
            if normalize_name(head).len() >= 5 {
                names.push(head.to_string());
            }
        }
    }
    for name in names.iter().filter(|n| !n.is_empty()) {
        let want = normalize_name(name);
        let stem = |n: &str| n.trim_end_matches(".dll").trim_end_matches(".vst3").to_string();
        let mut v: Vec<&PathBuf> = idx
            .by_name
            .iter()
            .filter(|(n, _)| (n.ends_with(".dll") || n.ends_with(".vst3")) && normalize_name(&stem(n)) == want)
            .flat_map(|(_, ps)| ps.iter())
            .filter(|p| is_plugin(p) && !(is_vst3_name(p) && !x64(p)))
            .collect();
        v.sort_by_key(|p| (is_vst3_name(p) != want_vst3, !x64(p), !in_install_folder(p)));
        if let Some(p) = v.first() {
            let how = if is_vst3_name(p) == want_vst3 { "matched by name" } else { "other format (default sound)" };
            return Some(((*p).clone(), how));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_by_shared_path_tail() {
        let stored = "%DataRoot%\\Packs\\Drums\\Kicks\\Kick 01.wav";
        let a = PathBuf::from("D:\\Samples\\Kick 01.wav");
        let b = PathBuf::from("C:\\Apps\\Studio\\Data\\Packs\\Drums\\Kicks\\Kick 01.wav");
        let comps = components(stored);
        assert_eq!(comps, vec!["packs", "drums", "kicks", "kick 01.wav"]);
        assert_eq!(suffix_score(&comps, &a), 1);
        assert_eq!(suffix_score(&comps, &b), 4);
    }

    #[test]
    fn names_compare_loosely() {
        assert_eq!(normalize_name("Delay Lama"), normalize_name("delay_lama"));
        assert_eq!(file_name_lower("C:/x/Y/Kick.WAV"), "kick.wav");
    }
}

#[cfg(test)]
mod machine_tests {
    /// `cargo test -p fls-host -- --ignored --nocapture locate_real`: index this
    /// machine and resolve paths given in FLS_LOCATE_SAMPLES (`;`-separated).
    #[test]
    #[ignore]
    fn locate_real() {
        let samples: Vec<String> = std::env::var("FLS_LOCATE_SAMPLES").unwrap_or_default().split(';').filter(|s| !s.is_empty()).map(str::to_string).collect();
        let plugins: Vec<serde_json::Value> = std::env::var("FLS_LOCATE_PLUGINS").unwrap_or_default().split(';').filter(|s| !s.is_empty()).map(|n| serde_json::json!({ "name": n, "path": format!("C:/Nowhere/{n}.dll") })).collect();
        let t = std::time::Instant::now();
        let r = super::resolve(&serde_json::json!({ "samples": samples, "plugins": plugins }));
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
        println!("total {:.2}s", t.elapsed().as_secs_f32());
    }
}

// ── Browser ──────────────────────────────────────────────────────────────────

/// Folders the browser starts from: the user's own, the ones they pointed at,
/// and other drives.
pub fn browse_roots() -> Value {
    let mut out = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        for sub in ["Desktop", "Documents", "Downloads", "Music"] {
            let p = home.join(sub);
            if p.is_dir() {
                out.push(json!({ "name": sub, "path": p.to_string_lossy() }));
            }
        }
    }
    for extra in crate::files::setting("searchFolders").and_then(|v| v.as_array().cloned()).unwrap_or_default() {
        if let Some(s) = extra.as_str().filter(|s| Path::new(s).is_dir()) {
            let name = Path::new(s).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| s.to_string());
            out.push(json!({ "name": name, "path": s }));
        }
    }
    for letter in b'C'..=b'Z' {
        let d = format!("{}:\\", letter as char);
        if Path::new(&d).is_dir() {
            out.push(json!({ "name": format!("{}:", letter as char), "path": d }));
        }
    }
    json!({ "roots": out })
}

/// One folder for the browser: sub-folders and the audio files in it. The
/// files become readable by the UI (preview, drag onto a channel).
pub fn list_dir(path: &str) -> Value {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    if let Ok(rd) = std::fs::read_dir(path) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.starts_with('$') {
                continue;
            }
            match e.file_type() {
                Ok(t) if t.is_dir() => dirs.push(name),
                Ok(t) if t.is_file() && wanted(&e.path()) && !PLUGIN.iter().any(|x| name.to_lowercase().ends_with(x)) => {
                    allow(&e.path());
                    files.push(json!({ "name": name, "path": e.path().to_string_lossy(), "size": e.metadata().map(|m| m.len()).unwrap_or(0) }));
                }
                _ => {}
            }
        }
    }
    dirs.sort_by_key(|d| d.to_lowercase());
    files.sort_by_key(|f| f["name"].as_str().unwrap_or("").to_lowercase());
    json!({ "path": path, "dirs": dirs, "files": files })
}

/// Installed plugins (from the file index, plugin install folders only).
pub fn list_plugins() -> Value {
    let (idx, _) = index(false);
    let mut seen = HashSet::new();
    let mut out: Vec<Value> = idx
        .by_name
        .iter()
        .filter(|(n, _)| n.ends_with(".dll") || n.ends_with(".vst3"))
        .flat_map(|(_, ps)| ps.iter())
        .filter(|p| in_install_folder(p) && seen.insert(norm(p)) && is_plugin(p))
        .map(|p| {
            let arch = plugin_arch(p);
            let name = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            json!({
                "name": name, "path": p.to_string_lossy(),
                "format": if is_vst3_name(p) { "VST3" } else { "VST" },
                "bits": if arch == fls_native::pe::Arch::X86 { 32 } else { 64 },
            })
        })
        .filter(|v| !(v["format"] == "VST3" && v["bits"] == 32))
        .collect();
    out.sort_by_key(|v| v["name"].as_str().unwrap_or("").to_lowercase());
    json!({ "plugins": out })
}
