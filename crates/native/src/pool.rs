//! Rendering plugins on several cores. Each block, the audio thread posts a
//! job ("render these N sources"), wakes the workers and claims sources
//! itself; whoever is free takes the next one. The audio thread returns once
//! all N are done. Sources render into their own buffers, so there's nothing
//! to lock between them.
//!
//! A job's slot index carries its generation: a worker that wakes late can
//! only ever claim work from the job it was woken for — once the audio thread
//! has moved on, its claim fails and it goes back to sleep.

use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, AtomicUsize, Ordering::*};
use std::sync::Arc;
use std::thread::{JoinHandle, Thread};

/// One unit of work; `run(i)` renders source `i` of the current job.
pub trait Job: Sync {
    fn run(&self, i: usize);
}

struct Shared {
    /// (generation << 32) | next index to claim.
    next: AtomicU64,
    len: AtomicUsize,
    remaining: AtomicUsize,
    job: AtomicPtr<()>,
    /// The vtable half of the current `&dyn Job` (fat pointer split in two).
    job_vt: AtomicPtr<()>,
    stop: AtomicBool,
}

pub struct Pool {
    shared: Arc<Shared>,
    threads: Vec<Thread>,
    handles: Vec<JoinHandle<()>>,
    gen: u64,
}

impl Pool {
    /// `workers` helper threads (0 = everything runs on the caller).
    pub fn new(workers: usize) -> Pool {
        let shared = Arc::new(Shared {
            next: AtomicU64::new(0),
            len: AtomicUsize::new(0),
            remaining: AtomicUsize::new(0),
            job: AtomicPtr::new(std::ptr::null_mut()),
            job_vt: AtomicPtr::new(std::ptr::null_mut()),
            stop: AtomicBool::new(false),
        });
        let mut handles = Vec::new();
        for i in 0..workers {
            let s = shared.clone();
            if let Ok(h) = std::thread::Builder::new().name(format!("audio-worker-{i}")).spawn(move || worker(s)) {
                handles.push(h);
            }
        }
        let threads = handles.iter().map(|h| h.thread().clone()).collect();
        Pool { shared, threads, handles, gen: 0 }
    }

    /// Helpers for this machine: all cores but one, at most 7.
    pub fn for_machine() -> Pool {
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
        Pool::new(cores.saturating_sub(1).min(7))
    }

    pub fn workers(&self) -> usize {
        self.threads.len()
    }

    /// Run `job.run(0..len)` across the pool and the calling thread; returns
    /// when every index has run. Never allocates.
    pub fn run(&mut self, job: &dyn Job, len: usize) {
        if len == 0 {
            return;
        }
        if len == 1 || self.threads.is_empty() {
            for i in 0..len {
                job.run(i);
            }
            return;
        }
        self.gen = (self.gen + 1) & 0xffff_ffff;
        let s = &self.shared;
        // SAFETY: the job outlives this call, and workers only touch it after a
        // successful claim, which can only happen before `remaining` hits 0.
        let (data, vt): (*mut (), *mut ()) = unsafe { std::mem::transmute(job as *const dyn Job) };
        s.job.store(data, Relaxed);
        s.job_vt.store(vt, Relaxed);
        s.len.store(len, Relaxed);
        s.remaining.store(len, Relaxed);
        s.next.store(self.gen << 32, Release);
        // Wake only as many helpers as there is work for.
        for t in self.threads.iter().take(len - 1) {
            t.unpark();
        }
        claim_and_run(s, self.gen);
        while s.remaining.load(Acquire) != 0 {
            std::hint::spin_loop();
        }
    }
}

/// Claim indices of job `gen` until there are none left.
fn claim_and_run(s: &Shared, gen: u64) {
    loop {
        let cur = s.next.load(Acquire);
        if cur >> 32 != gen {
            return;
        }
        let i = (cur & 0xffff_ffff) as usize;
        if i >= s.len.load(Relaxed) {
            return;
        }
        if s.next.compare_exchange_weak(cur, cur + 1, AcqRel, Relaxed).is_err() {
            continue;
        }
        // SAFETY: claimed index of the live job (see `run`).
        let job: &dyn Job = unsafe { &*std::mem::transmute::<(*mut (), *mut ()), *const dyn Job>((s.job.load(Relaxed), s.job_vt.load(Relaxed))) };
        job.run(i);
        s.remaining.fetch_sub(1, Release);
    }
}

fn worker(s: Arc<Shared>) {
    crate::rt::pro_audio_priority();
    loop {
        std::thread::park();
        if s.stop.load(Acquire) {
            return;
        }
        crate::rt::denormals_off();
        let gen = s.next.load(Acquire) >> 32;
        claim_and_run(&s, gen);
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        self.shared.stop.store(true, Release);
        for t in &self.threads {
            t.unpark();
        }
        for h in self.handles.drain(..) {
            let _ = h.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    struct Count(Vec<AtomicU32>);
    impl Job for Count {
        fn run(&self, i: usize) {
            // A little work so several threads take part.
            let mut x = 0u64;
            for k in 0..20_000 {
                x = x.wrapping_mul(31).wrapping_add(k);
            }
            std::hint::black_box(x);
            self.0[i].fetch_add(1, SeqCst);
        }
    }

    #[test]
    fn every_index_runs_exactly_once_per_job() {
        let mut pool = Pool::new(3);
        let job = Count((0..13).map(|_| AtomicU32::new(0)).collect());
        for _ in 0..2000 {
            pool.run(&job, 13);
        }
        assert!(job.0.iter().all(|c| c.load(SeqCst) == 2000));
        // Different sizes back to back, including single-item and empty jobs.
        let small = Count((0..2).map(|_| AtomicU32::new(0)).collect());
        for n in [2, 1, 0, 2] {
            pool.run(&small, n);
        }
        assert_eq!(small.0[0].load(SeqCst), 3);
        assert_eq!(small.0[1].load(SeqCst), 2);
    }
}
