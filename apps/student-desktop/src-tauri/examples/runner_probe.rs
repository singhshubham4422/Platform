use std::{
    io::{self, Read, Write},
    process::Command,
    thread,
    time::Duration,
};
fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("sleep") => thread::sleep(Duration::from_secs(30)),
        Some("busy") => loop {
            std::hint::spin_loop()
        },
        Some("alloc") => {
            let n = args
                .next()
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(512);
            let mut v = vec![0u8; n * 1024 * 1024];
            for i in (0..v.len()).step_by(4096) {
                v[i] = 1;
            }
            thread::sleep(Duration::from_secs(3));
        }
        Some("flood") => {
            let mut o = io::stdout();
            for _ in 0..10 * 1024 {
                let _ = o.write_all(&[b'x'; 1024]);
            }
        }
        Some("exit") => std::process::exit(args.next().and_then(|v| v.parse().ok()).unwrap_or(3)),
        Some("env") => {
            for (k, v) in std::env::vars() {
                println!("{k}={v}");
            }
        }
        Some("children") => loop {
            let exe = std::env::current_exe().unwrap();
            let _ = Command::new(exe).arg("sleep").spawn();
        },
        Some("echo") => {
            let mut s = String::new();
            let _ = io::stdin().read_to_string(&mut s);
            print!("{s}");
        }
        _ => println!("ok"),
    }
}
