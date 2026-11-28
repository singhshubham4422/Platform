use std::{os::unix::process::CommandExt, process::Command, time::Duration};

pub fn configure(command: &mut Command, _java: bool) {
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}
/// Student programs get address-space, process and file-size caps. A compile step runs the
/// trusted toolchain (clang, javac's JVM), which reserves far more address space than it uses,
/// starts helper processes and writes large cached libraries, so it keeps only CPU and core limits.
pub fn set_limits(
    command: &mut Command,
    cpu_time: Duration,
    memory_mb: u64,
    java: bool,
    compile: bool,
) {
    let secs = (cpu_time.as_secs().max(1).min(i32::MAX as u64)) as libc::rlim_t;
    let reserve = if java { 512 } else { 0 };
    let mem = memory_mb
        .saturating_add(reserve)
        .saturating_mul(1024 * 1024) as libc::rlim_t;
    unsafe {
        command.pre_exec(move || {
            let all = [
                (libc::RLIMIT_CPU, secs, secs.saturating_add(1)),
                (libc::RLIMIT_CORE, 0, 0),
                (libc::RLIMIT_AS, mem, mem),
                (libc::RLIMIT_NPROC, 64, 64),
                (libc::RLIMIT_FSIZE, 16 * 1024 * 1024, 16 * 1024 * 1024),
            ];
            let limits = if compile { &all[..2] } else { &all[..] };
            for &(resource, soft, hard) in limits {
                let lim = libc::rlimit {
                    rlim_cur: soft,
                    rlim_max: hard,
                };
                if libc::setrlimit(resource, &lim) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
}
