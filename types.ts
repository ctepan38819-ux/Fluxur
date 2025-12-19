
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
  isBlocked?: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: Date;
  isAiGenerated?: boolean;
}

export interface Chat {
  id: string;
  name: string;
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
