import type { ScreenshotAttachment } from "./types";
import {
  captureRegionInteractive,
  screenshotResultToAttachment,
} from "./screenshotApi";

let activeCapture: Promise<ScreenshotAttachment | null> | null = null;

export function startScreenshot(): Promise<ScreenshotAttachment | null> {
  if (activeCapture) {
    return activeCapture;
  }

  activeCapture = captureRegionInteractive()
    .then((result) =>
      result.action === "send" ? screenshotResultToAttachment(result) : null,
    )
    .catch((error) => {
      if (String(error).toLowerCase().includes("cancelled")) {
        return null;
      }
      throw error;
    })
    .finally(() => {
      activeCapture = null;
    });

  return activeCapture;
}
