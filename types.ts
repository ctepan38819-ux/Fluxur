
export interface User {
  id: string;
  name: string;
  login: string;
  password?: string; // For mock persistence
  avatar: string;
  status: 'online' | 'offline' | 'away';
  isAI?: boolean;
  isPremium?: boolean;
  premiumStatus?: 'none' | 'pending' | 'active';
  role?: 'developer' | 'user' | 'admin';
  theme?: 'dark' | 'light' | 'midnight';
  language?: 'ru' | 'en';
  isBlocked?: boolean;
}

export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  url: string; // Base64 for this mock
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text?: string;
  timestamp: Date;
  isAiGenerated?: boolean;
  file?: FileAttachment;
  isCallLog?: boolean;
  callDuration?: string;
}

export interface Chat {
  id: string;
  name: string;
  handle?: string; // Unique login for groups/channels
  participants: string[]; // IDs of users
  messages: Message[];
  lastMessage?: string;
  type: 'direct' | 'group' | 'ai' | 'channel';
  creatorId: string;
  isBlocked?: boolean;
}

export enum FluxurView {
  CHATS = 'chats',
  SETTINGS = 'settings',
  PROFILE = 'profile',
  AUTH = 'auth',
  ADMIN = 'admin'
}
