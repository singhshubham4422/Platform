use std::{mem, time::Duration};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_JOB_TIME,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
            SetInformationJobObject,
        },
        Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
    },
};

pub struct Job(HANDLE);
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
pub fn assign_job(pid: Option<u32>, memory_mb: u64, timeout: Duration) -> Result<Job, String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err("IO: CreateJobObject failed".into());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_JOB_TIME
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        info.ProcessMemoryLimit = memory_mb.saturating_mul(1024 * 1024) as usize;
        info.BasicLimitInformation.ActiveProcessLimit = 16;
        info.BasicLimitInformation.PerJobUserTimeLimit =
            (timeout.as_nanos().min(i64::MAX as u128)) as i64;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            mem::size_of_val(&info) as u32,
        ) == 0
        {
            CloseHandle(job);
            return Err("IO: SetInformationJobObject failed".into());
        }
        let proc = OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE,
            0,
            pid.unwrap_or_default(),
        );
        if proc.is_null() {
            CloseHandle(job);
            return Err("IO: OpenProcess failed".into());
        }
        let ok = AssignProcessToJobObject(job, proc);
        CloseHandle(proc);
        if ok == 0 {
            CloseHandle(job);
            return Err("IO: AssignProcessToJobObject failed".into());
        }
        Ok(Job(job))
    }
}
