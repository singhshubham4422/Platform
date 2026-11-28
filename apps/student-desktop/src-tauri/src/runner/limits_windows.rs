//! Windows Job Object limits for one student process tree.
//!
//! - Per-process memory, total job CPU time, at most 16 active processes (fork-bomb guard),
//!   kill-on-close and no crash dialogs.
//! - A completion port receives the job's limit notifications, so the runner can tell
//!   "memory limit" and "CPU time limit" apart from an ordinary crash.
//! - Known gap: the process is assigned to the job right after `spawn`, not created suspended.
//!   The window is a few microseconds, before the student's `main` runs.
use std::{mem, ptr, time::Duration};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        IO::{CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED},
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_JOB_TIME,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
            JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectAssociateCompletionPortInformation,
            JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation,
            QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

// winnt.h JOB_OBJECT_MSG_* values (kept local to avoid another windows-sys feature).
const MSG_END_OF_JOB_TIME: u32 = 1;
const MSG_PROCESS_MEMORY_LIMIT: u32 = 9;
const MSG_JOB_MEMORY_LIMIT: u32 = 10;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct JobStats {
    pub peak_kb: u64,
    pub cpu_ms: u64,
    pub memory_limit_hit: bool,
    pub cpu_limit_hit: bool,
}

pub struct Job {
    job: HANDLE,
    port: HANDLE,
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.job);
            if !self.port.is_null() {
                CloseHandle(self.port);
            }
        }
    }
}

impl Job {
    /// Ends every process still in the job (children left behind by the student's program).
    pub fn kill_all(&self) {
        unsafe {
            TerminateJobObject(self.job, 1);
        }
    }

    /// Current total user CPU time used by all processes in the job, in milliseconds.
    pub fn cpu_ms(&self) -> u64 {
        unsafe {
            let mut acct: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = mem::zeroed();
            if QueryInformationJobObject(
                self.job,
                JobObjectBasicAccountingInformation,
                &mut acct as *mut _ as *mut _,
                mem::size_of_val(&acct) as u32,
                ptr::null_mut(),
            ) != 0
            {
                (acct.TotalUserTime.max(0) / 10_000) as u64
            } else {
                0
            }
        }
    }

    /// Reads peak memory, CPU time and any limit notifications. Call after the process exited.
    pub fn stats(&self) -> JobStats {
        let mut s = JobStats::default();
        unsafe {
            let mut ext: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
            if QueryInformationJobObject(
                self.job,
                JobObjectExtendedLimitInformation,
                &mut ext as *mut _ as *mut _,
                mem::size_of_val(&ext) as u32,
                ptr::null_mut(),
            ) != 0
            {
                s.peak_kb = (ext.PeakProcessMemoryUsed / 1024) as u64;
            }
            let mut acct: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = mem::zeroed();
            if QueryInformationJobObject(
                self.job,
                JobObjectBasicAccountingInformation,
                &mut acct as *mut _ as *mut _,
                mem::size_of_val(&acct) as u32,
                ptr::null_mut(),
            ) != 0
            {
                // 100-nanosecond ticks.
                s.cpu_ms = (acct.TotalUserTime.max(0) / 10_000) as u64;
            }
            if !self.port.is_null() {
                let (mut msg, mut key, mut ov): (u32, usize, *mut OVERLAPPED) =
                    (0, 0, ptr::null_mut());
                while GetQueuedCompletionStatus(self.port, &mut msg, &mut key, &mut ov, 0) != 0 {
                    match msg {
                        MSG_PROCESS_MEMORY_LIMIT | MSG_JOB_MEMORY_LIMIT => {
                            s.memory_limit_hit = true
                        }
                        MSG_END_OF_JOB_TIME => s.cpu_limit_hit = true,
                        _ => {}
                    }
                }
            }
        }
        s
    }
}

pub fn assign_job(
    pid: Option<u32>,
    memory_mb: u64,
    cpu_limit: Duration,
    max_processes: u32,
) -> Result<Job, String> {
    unsafe {
        let job = CreateJobObjectW(ptr::null(), ptr::null());
        if job.is_null() {
            return Err("IO: CreateJobObject failed".into());
        }
        let port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, ptr::null_mut(), 0, 1);
        let guard = Job { job, port };
        if !port.is_null() {
            let assoc = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
                CompletionKey: ptr::null_mut(),
                CompletionPort: port,
            };
            // Best effort: without the port, limits still apply but verdicts are less precise.
            SetInformationJobObject(
                job,
                JobObjectAssociateCompletionPortInformation,
                &assoc as *const _ as *const _,
                mem::size_of_val(&assoc) as u32,
            );
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_JOB_TIME
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        info.ProcessMemoryLimit = memory_mb.saturating_mul(1024 * 1024) as usize;
        info.BasicLimitInformation.ActiveProcessLimit = max_processes;
        // PerJobUserTimeLimit is in 100-nanosecond ticks.
        info.BasicLimitInformation.PerJobUserTimeLimit =
            ((cpu_limit.as_nanos() / 100).min(i64::MAX as u128)) as i64;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            mem::size_of_val(&info) as u32,
        ) == 0
        {
            return Err("IO: SetInformationJobObject failed".into());
        }
        let proc = OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE,
            0,
            pid.unwrap_or_default(),
        );
        if proc.is_null() {
            return Err("IO: OpenProcess failed".into());
        }
        let ok = AssignProcessToJobObject(job, proc);
        CloseHandle(proc);
        if ok == 0 {
            return Err("IO: AssignProcessToJobObject failed".into());
        }
        Ok(guard)
    }
}
