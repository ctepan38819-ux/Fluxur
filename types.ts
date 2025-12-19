
export interface User {
  id: string;
  name: string;
  login: string;
  password?: string;
  avatar: string;
  status: 'online' | 'offline' | 'away';
  isAI?: boolean;
  isPremium?: boolean;
  premiumStatus?: 'none' | 'pending' | 'active';
  role?: 'developer' | 'user' | 'admin';
  theme?: 'dark' | 'light' | 'midnight' | 'forest' | 'sunset';
  language?: string; // Changed to string to support "any language"
  isBlocked?: boolean;
}

export interface FileAttachment {
  name: string;
  type: string;
  size: number;
  url: string;
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
  handle?: string;
  participants: string[];
  bannedUsers?: Record<string, number>; // userId -> timestamp of expiry
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
