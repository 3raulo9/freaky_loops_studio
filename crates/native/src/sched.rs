//! Timed plugin events. The UI schedules notes ahead of time; each carries
//! the engine frame it's due at, and the audio thread hands it to the plugin
//! at that exact sample inside the block — not at the start of whichever
//! callback happened to pick it up.

use std::sync::Mutex;

/// Due "as soon as possible".
pub const NOW: u64 = 0;

/// Producer side (UI / IPC thread).
pub struct Inbox<E> {
    q: Mutex<Vec<(u64, E)>>,
}

impl<E: Copy> Inbox<E> {
    pub fn new() -> Self {
        Inbox { q: Mutex::new(Vec::with_capacity(256)) }
    }

    pub fn push(&self, at: u64, e: E) {
        if let Ok(mut q) = self.q.lock() {
            if q.len() < 8192 {
                q.push((at, e));
            }
        }
    }

    /// Drop queued events the predicate rejects (e.g. pending note-ons when
    /// the transport stops).
    pub fn retain(&self, f: impl FnMut(&(u64, E)) -> bool) {
        if let Ok(mut q) = self.q.lock() {
            q.retain(f);
        }
    }
}

impl<E: Copy> Default for Inbox<E> {
    fn default() -> Self {
        Self::new()
    }
}

/// Consumer side, owned by the audio thread: events taken from the inbox,
/// kept in due order. Never allocates after construction.
pub struct Due<E> {
    list: Vec<(u64, E)>,
}

impl<E: Copy> Due<E> {
    pub fn with_capacity(n: usize) -> Self {
        Due { list: Vec::with_capacity(n) }
    }

    /// Move new events in (skipped if the UI thread holds the inbox right now
    /// — they're picked up next block) and keep the list in due order.
    pub fn take(&mut self, inbox: &Inbox<E>) {
        let Ok(mut q) = inbox.q.try_lock() else { return };
        let room = self.list.capacity() - self.list.len();
        let n = q.len().min(room);
        self.list.extend(q.drain(..n));
        drop(q);
        // Insertion sort: stable (a note-off and a note-on on the same frame keep
        // their order) and cheap for the nearly sorted lists the UI sends.
        for i in 1..self.list.len() {
            let mut j = i;
            while j > 0 && self.list[j - 1].0 > self.list[j].0 {
                self.list.swap(j - 1, j);
                j -= 1;
            }
        }
    }

    /// Hand every event due before `end` to `f` with its offset from `start`
    /// (late events land at offset 0), at most `max` of them.
    pub fn split(&mut self, start: u64, end: u64, max: usize, mut f: impl FnMut(u32, E)) {
        let k = self.list.iter().take(max).take_while(|(at, _)| *at < end).count();
        for &(at, e) in &self.list[..k] {
            f(at.saturating_sub(start).min(u32::MAX as u64) as u32, e);
        }
        self.list.drain(..k);
    }

    pub fn clear(&mut self) {
        self.list.clear();
    }

    pub fn retain(&mut self, f: impl FnMut(&(u64, E)) -> bool) {
        self.list.retain(f);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hands_out_events_at_their_offsets() {
        let inbox = Inbox::new();
        inbox.push(1100, "b");
        inbox.push(1030, "a");
        inbox.push(900, "late");
        inbox.push(5000, "later");
        let mut due = Due::with_capacity(16);
        due.take(&inbox);
        let mut got = Vec::new();
        due.split(1000, 1128, 16, |off, e| got.push((off, e)));
        assert_eq!(got, vec![(0, "late"), (30, "a"), (100, "b")]);
        got.clear();
        due.split(1128, 1256, 16, |off, e| got.push((off, e)));
        assert!(got.is_empty());
        due.split(4990, 5118, 16, |off, e| got.push((off, e)));
        assert_eq!(got, vec![(10, "later")]);
    }

    #[test]
    fn same_frame_keeps_order_and_caps_per_block() {
        let inbox = Inbox::new();
        for i in 0..10 {
            inbox.push(10, i);
        }
        let mut due = Due::with_capacity(64);
        due.take(&inbox);
        let mut got = Vec::new();
        due.split(0, 64, 4, |_, e| got.push(e));
        assert_eq!(got, vec![0, 1, 2, 3]);
        due.split(64, 128, 64, |_, e| got.push(e));
        assert_eq!(got, (0..10).collect::<Vec<_>>());
    }
}
