use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

pub struct AppState {
    attached: Arc<AtomicBool>,
    widget_visible: Arc<AtomicBool>,
    allow_exit: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(
        attached: Arc<AtomicBool>,
        widget_visible: Arc<AtomicBool>,
        allow_exit: Arc<AtomicBool>,
    ) -> Self {
        Self {
            attached,
            widget_visible,
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

    pub fn widget_visible_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.widget_visible)
    }

    pub fn set_widget_visible(&self, visible: bool) {
        self.widget_visible.store(visible, Ordering::Relaxed);
    }

    pub fn allow_exit(&self) {
        self.allow_exit.store(true, Ordering::Relaxed);
    }
}
