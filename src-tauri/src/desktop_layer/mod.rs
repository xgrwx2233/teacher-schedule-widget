#[cfg(all(feature = "desktop-win10", feature = "desktop-win11"))]
compile_error!("features desktop-win10 and desktop-win11 are mutually exclusive");

#[cfg(feature = "desktop-win10")]
mod win10;
#[cfg(not(feature = "desktop-win10"))]
mod win11;

#[cfg(feature = "desktop-win10")]
pub use win10::*;
#[cfg(not(feature = "desktop-win10"))]
pub use win11::*;
