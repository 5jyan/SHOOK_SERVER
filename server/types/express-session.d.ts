import "express-session";

declare module "express-session" {
  interface SessionData {
    forceKakaoSync?: {
      channels: boolean;
      videos: boolean;
    };
  }
}

export {};
