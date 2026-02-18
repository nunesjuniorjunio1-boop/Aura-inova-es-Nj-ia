export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: {
    type: 'image' | 'video' | 'audio' | 'file';
    url: string;
    mimeType: string;
    name: string;
  }[];
  isLoading?: boolean;
  grounding?: {
    search?: { uri: string; title: string }[];
    maps?: { uri: string; title: string }[];
  };
}

export enum AppMode {
  CHAT = 'chat',
  LIVE = 'live',
  STUDIO = 'studio',
}

export interface StudioConfig {
  aspectRatio: string;
  imageSize: string; // 1K, 2K, 4K
  resolution: string; // 720p, 1080p (Video)
}

export interface AudioConfig {
  voiceName: string;
}

// Helper to define global window for Veo auth
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
    webkitAudioContext: typeof AudioContext;
  }
}