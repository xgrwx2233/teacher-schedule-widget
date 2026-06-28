import { startScreenshot } from "./screenshotController";
import type { ScreenshotAttachment } from "./types";
import type { MouseEvent, ReactNode } from "react";

type ScreenshotButtonProps = {
  children?: ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
  onBeforeStart?: () => boolean | void | Promise<boolean | void>;
  onCaptured: (attachment: ScreenshotAttachment) => void;
  onError?: (error: unknown) => void;
  onFinished?: (attachment: ScreenshotAttachment | null) => void | Promise<void>;
};

export function ScreenshotButton({
  children,
  className,
  title = "截图",
  disabled = false,
  onBeforeStart,
  onCaptured,
  onError,
  onFinished,
}: ScreenshotButtonProps) {
  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (disabled) {
      return;
    }

    let started = false;
    let attachment: ScreenshotAttachment | null = null;
    try {
      const shouldContinue = await onBeforeStart?.();
      if (shouldContinue === false) {
        return;
      }
      started = true;
      attachment = await startScreenshot();
      if (attachment) {
        onCaptured(attachment);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      if (started) {
        await onFinished?.(attachment);
      }
    }
  };

  return (
    <button
      type="button"
      title={title}
      className={className}
      disabled={disabled}
      onClick={(event) => void handleClick(event)}
    >
      {children ?? "截图"}
    </button>
  );
}
