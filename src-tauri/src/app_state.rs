use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub struct AppState {
    attached: Arc<AtomicBool>,
    allow_exit: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(attached: Arc<AtomicBool>, allow_exit: Arc<AtomicBool>) -> Self {
        Self {
            attached,
            allow_exit,
        }
    }

    pub fn attached_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.attached)
    }

    pub fn is_attached(&self) -> bool {
        self.attached.load(Ordering::Relaxed)
    }

    pub fn set_attached(&self, attached: bool) {
        self.attached.store(attached, Ordering::Relaxed);
    }

    pub fn allow_exit(&self) {
        self.allow_exit.store(true, Ordering::Relaxed);
    }
}
