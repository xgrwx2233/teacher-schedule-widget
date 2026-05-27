use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
    Mutex,
};

pub struct AppState {
    attached: Arc<AtomicBool>,
    widget_visible: Arc<AtomicBool>,
    allow_exit: Arc<AtomicBool>,
    block_settings_window_state: Arc<Mutex<Option<String>>>,
    block_type_confirm_window_state: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn new(
        attached: Arc<AtomicBool>,
        widget_visible: Arc<AtomicBool>,
        allow_exit: Arc<AtomicBool>,
        block_settings_window_state: Arc<Mutex<Option<String>>>,
        block_type_confirm_window_state: Arc<Mutex<Option<String>>>,
    ) -> Self {
        Self {
            attached,
            widget_visible,
            allow_exit,
            block_settings_window_state,
            block_type_confirm_window_state,
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

    pub fn set_block_settings_window_state(&self, state: Option<String>) {
        let mut guard = self.block_settings_window_state.lock().expect("block settings state poisoned");
        *guard = state;
    }

    pub fn block_settings_window_state(&self) -> Option<String> {
        self.block_settings_window_state
            .lock()
            .expect("block settings state poisoned")
            .clone()
    }

    pub fn set_block_type_confirm_window_state(&self, state: Option<String>) {
        let mut guard = self
            .block_type_confirm_window_state
            .lock()
            .expect("block type confirm state poisoned");
        *guard = state;
    }

    pub fn block_type_confirm_window_state(&self) -> Option<String> {
        self.block_type_confirm_window_state
            .lock()
            .expect("block type confirm state poisoned")
            .clone()
    }
}
