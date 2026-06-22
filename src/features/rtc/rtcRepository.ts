import { invoke } from "@tauri-apps/api/core";
import type { RtcToken } from "./types";

export async function getRtcToken(channelId: string): Promise<RtcToken> {
  return invoke<RtcToken>("get_rtc_token", { channelId });
}

