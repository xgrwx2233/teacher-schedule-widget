export type ScreenshotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
};

export type ScreenshotResult = {
  filePath: string;
  width: number;
  height: number;
};

export type ScreenshotAttachment = {
  id: string;
  filePath: string;
  previewUrl: string;
  name: string;
  mimeType: "image/png";
  width: number;
  height: number;
  source: "screenshot";
};
