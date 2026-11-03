//! `cargo run -p fls-projfile --example dump -- <file> [--json]`: parse a project
//! and print a summary (or the full JSON) — handy for checking real files locally.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");
    // Directories expand to the project files inside them.
    let mut files: Vec<String> = Vec::new();
    for a in args.iter().filter(|a| !a.starts_with("--")) {
        match std::fs::read_dir(a) {
            Ok(rd) => {
                let mut v: Vec<String> = rd.flatten().map(|e| e.path().to_string_lossy().into_owned()).filter(|p| p.to_ascii_lowercase().ends_with(".flp")).collect();
                v.sort();
                files.extend(v);
            }
            Err(_) => files.push(a.clone()),
        }
    }
    for path in &files {
        let Ok(bytes) = std::fs::read(path) else {
            println!("{path}: unreadable");
            continue;
        };
        let t = std::time::Instant::now();
        match fls_projfile::parse(&bytes) {
            Ok(p) => {
                let out = p.to_json();
                let ms = t.elapsed().as_secs_f64() * 1000.0;
                if json {
                    println!("{out}");
                    continue;
                }
                let notes: usize = p.patterns.iter().map(|x| x.notes.len()).sum();
                let items: usize = p.arrangements.iter().map(|a| a.items.len()).sum();
                let vsts = p.channels.iter().filter(|c| c.plugin.vst.is_some()).count()
                    + p.inserts.iter().flat_map(|i| &i.slots).filter(|s| s.plugin.vst.is_some()).count();
                let fx: usize = p.inserts.iter().map(|i| i.slots.len()).sum();
                println!(
                    "{:<44} v{:<14} {:>6.1} bpm  ch {:>3}  pat {:>3}  notes {:>5}  items {:>4}  ins {:>3}  fx {:>3}  vst {:>2}  {:>6} KB json  {:.2} ms",
                    path.rsplit(['/', '\\']).next().unwrap_or(path).chars().take(44).collect::<String>(),
                    p.version, p.tempo, p.channels.len(), p.patterns.len(), notes, items, p.inserts.len(), fx, vsts, out.len() / 1024, ms
                );
            }
            Err(e) => println!("{path}: ERROR {e}"),
        }
    }
}
