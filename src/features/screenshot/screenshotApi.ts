import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  ScreenshotAttachment,
  ScreenshotRect,
  ScreenshotResult,
} from "./types";

export async function captureRegionInteractive(): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>("capture_region_interactive");
}

export async function captureRegion(rect: ScreenshotRect): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>("capture_region", {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    scaleFactor: rect.scaleFactor || 1,
  });
}

export function screenshotResultToAttachment(result: ScreenshotResult): ScreenshotAttachment {
  const name = fileNameFromPath(result.filePath) || `screenshot-${Date.now()}.png`;
  return {
    id: `screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    filePath: result.filePath,
    previewUrl: convertFileSrc(result.filePath),
    name,
    mimeType: "image/png",
    width: result.width,
    height: result.height,
    source: "screenshot",
  };
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
