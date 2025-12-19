
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView, FileAttachment } from './types';
import { ICONS, COLORS } from './constants';
import { translations } from './translations';
import { chatWithAssistant, summarizeConversation } from './geminiService';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';

// --- Audio Utilities ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

const AI_USER: User = {
  id: 'fluxur-ai',
  name: 'Fluxur AI',
  login: 'fluxai',
  avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=fluxai',
  status: 'online',
  isAI: true
};

const DEVELOPER_LOGIN = 'stephan_rogovoy';

export default function App() {
  const [activeView, setActiveView] = useState<FluxurView>(FluxurView.AUTH);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  
  // Call state
  const [activeCall, setActiveCall] = useState<{ chatId: string; status: 'ringing' | 'active' | 'no-answer'; startTime: number } | null>(null);
  const [callTimer, setCallTimer] = useState(0);
  const [callTranscription, setCallTranscription] = useState('');

  // Live API refs
  const sessionRef = useRef<any>(null);
  const audioContextsRef = useRef<{ input?: AudioContext; output?: AudioContext }>({});
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const ringingTimeoutRef = useRef<number | null>(null);

  const [newHandle, setNewHandle] = useState('');

  // --- Persistence: Initialization ---
  useEffect(() => {
    const savedUsers = localStorage.getItem('fluxur_users');
    const savedChats = localStorage.getItem('fluxur_chats');
    const savedSession = localStorage.getItem('fluxur_session');

    if (savedUsers) {
      setRegisteredUsers(JSON.parse(savedUsers));
    }
    if (savedChats) {
      setChats(JSON.parse(savedChats));
    }
    if (savedSession) {
      const user = JSON.parse(savedSession);
      setCurrentUser(user);
      setActiveView(FluxurView.CHATS);
    }
  }, []);

  // --- Persistence: Sync current session ---
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('fluxur_session', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('fluxur_session');
    }
  }, [currentUser]);

  // --- Persistence: Sync chat history ---
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('fluxur_chats', JSON.stringify(chats));
    }
  }, [chats]);

  const lang = currentUser?.language || 'en';
  const t = (key: keyof typeof translations['en']) => (translations[lang] || translations['en'])[key] || key;

  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [showMsgSearch, setShowMsgSearch] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState<'group' | 'channel' | null>(null);
  const [newName, setNewName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', login: '', password: '' });
  const [authError, setAuthError] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  useEffect(() => {
    let interval: number;
    if (activeCall?.status === 'active') {
      interval = window.setInterval(() => {
        setCallTimer(Math.floor((Date.now() - activeCall.startTime) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeCall]);

  const searchResults = useMemo(() => {
    const q = chatSearchQuery.toLowerCase().trim();
    if (!q) return { myChats: chats, globalUsers: [], globalChats: [] };

    const myChats = chats.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.handle && c.handle.toLowerCase().includes(q))
    );

    const existingDirectPartnerIds = chats
      .filter(c => c.type === 'direct')
      .flatMap(c => c.participants.filter(p => p !== currentUser?.id));

    const globalUsers = registeredUsers.filter(u => 
      u.id !== currentUser?.id &&
      !existingDirectPartnerIds.includes(u.id) &&
      (u.login.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
    );

    const globalChats = chats.filter(c => 
      (c.type === 'channel' || c.type === 'group') &&
      !c.participants.includes(currentUser?.id || '') &&
      (c.name.toLowerCase().includes(q) || (c.handle && c.handle.toLowerCase().includes(q)))
    );

    return { myChats, globalUsers, globalChats };
  }, [chats, registeredUsers, chatSearchQuery, currentUser]);

  const filteredMessages = useMemo(() => {
    if (!activeChat) return [];
    if (!messageSearchQuery.trim()) return activeChat.messages;
    return activeChat.messages.filter(m => 
      (m.text && m.text.toLowerCase().includes(messageSearchQuery.toLowerCase())) ||
      (m.file && m.file.name.toLowerCase().includes(messageSearchQuery.toLowerCase()))
    );
  }, [activeChat, messageSearchQuery]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeChat?.messages, isTyping]);

  const saveUsersToStorage = (users: User[]) => {
    setRegisteredUsers(users);
    localStorage.setItem('fluxur_users', JSON.stringify(users));
  };

  const handleAuth = () => {
    setAuthError('');
    const normalizedLogin = authForm.login.trim();
    if (authMode === 'register') {
      if (!authForm.login || !authForm.password || !authForm.name) {
        setAuthError(t('auth_err_fields'));
        return;
      }
      if (registeredUsers.find(u => u.login.toLowerCase() === normalizedLogin.toLowerCase())) {
        setAuthError(t('auth_err_taken'));
        return;
      }
      const isDev = normalizedLogin.toLowerCase() === DEVELOPER_LOGIN.toLowerCase();
      const newUser: User = {
        id: Math.random().toString(36).substr(2, 9),
        name: authForm.name,
        login: normalizedLogin,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${normalizedLogin}`,
        status: 'online',
        isPremium: isDev, 
        premiumStatus: isDev ? 'active' : 'none',
        role: isDev ? 'developer' : 'user',
        theme: 'dark',
        language: 'en',
        isBlocked: false
      };
      const allUsers = [...registeredUsers, { ...newUser, password: authForm.password }];
      saveUsersToStorage(allUsers);
      setCurrentUser(newUser);
      setActiveView(FluxurView.CHATS);
    } else {
      const user = registeredUsers.find(u => u.login === normalizedLogin && u.password === authForm.password);
      if (user) {
        if (user.isBlocked) {
          setAuthError(t('auth_err_blocked'));
          return;
        }
        const { password, ...userWithoutPassword } = user;
        setCurrentUser(userWithoutPassword);
        setActiveView(FluxurView.CHATS);
        const aiChatId = `ai-${user.id}`;
        if (!chats.find(c => c.id === aiChatId)) {
          const newAiChat: Chat = {
            id: aiChatId,
            name: 'Fluxur AI',
            type: 'ai',
            participants: [user.id, AI_USER.id],
            messages: [{ 
              id: 'welcome', 
              senderId: AI_USER.id, 
              senderName: AI_USER.name,
              text: t('ai_welcome').replace('{name}', user.name), 
              timestamp: new Date() 
            }],
            creatorId: 'system'
          };
          setChats(prev => [newAiChat, ...prev]);
        }
      } else {
        setAuthError(t('auth_err_invalid'));
      }
    }
  };

  const updateCurrentUser = (updates: Partial<User>) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, ...updates };
    setCurrentUser(updatedUser);
    const updatedList = registeredUsers.map(u => u.id === currentUser.id ? { ...u, ...updates, password: u.password } : u);
    saveUsersToStorage(updatedList);
  };

  const handleSendMessage = useCallback(async (file?: FileAttachment) => {
    if (!inputText.trim() && !file && !currentUser || !activeChat) return;
    if (activeChat.isBlocked) return;
    if (activeChat.type === 'channel' && activeChat.creatorId !== currentUser?.id && currentUser?.role !== 'developer') return;

    const currentText = inputText;
    const currentChatId = activeChat.id;
    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: currentUser!.id,
      senderName: currentUser!.name,
      text: currentText,
      timestamp: new Date(),
      file: file
    };

    setChats(prev => prev.map(c => 
      c.id === currentChatId ? { ...c, messages: [...c.messages, newMessage], lastMessage: file ? `File: ${file.name}` : currentText } : c
    ));
    setInputText('');

    if (activeChat.type === 'ai' && !file) {
      setIsTyping(true);
      try {
        const response = await chatWithAssistant(currentText, activeChat.messages);
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          senderId: AI_USER.id,
          senderName: AI_USER.name,
          text: response,
          timestamp: new Date(),
          isAiGenerated: true
        };
        setChats(prev => prev.map(c => 
          c.id === currentChatId ? { ...c, messages: [...c.messages, aiMessage], lastMessage: response } : c
        ));
      } catch (err) { 
        console.error(err); 
      } finally { 
        setIsTyping(false);
      }
    }
  }, [inputText, chats, currentUser, activeChat]);

  const handleStartCall = async () => {
    if (!activeChat || !currentUser) return;
    
    setActiveCall({ chatId: activeChat.id, status: 'ringing', startTime: Date.now() });
    setCallTranscription('');

    const willAnswer = activeChat.type === 'ai' || Math.random() > 0.4;
    
    if (!willAnswer) {
      ringingTimeoutRef.current = window.setTimeout(() => {
        handleNoAnswer();
      }, 8000);
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextsRef.current = { input: inCtx, output: outCtx };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            if (ringingTimeoutRef.current) {
              clearTimeout(ringingTimeoutRef.current);
              ringingTimeoutRef.current = null;
            }
            setActiveCall(prev => prev ? { ...prev, status: 'active', startTime: Date.now() } : null);
            const source = inCtx.createMediaStreamSource(stream);
            const scriptProcessor = inCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              setCallTranscription(prev => prev + message.serverContent!.outputTranscription!.text);
            }
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outCtx.destination);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: () => handleEndCall(),
          onclose: () => handleEndCall(),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: activeChat.type === 'ai' 
            ? "You are Fluxur AI, speaking in a high-fidelity voice call. Be concise, helpful, and natural."
            : `You are the user "${activeChat.name}". Someone is calling you on Fluxur Messenger. Act naturally as this person.`,
        },
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error('Failed to start call:', err);
      handleEndCall();
    }
  };

  const handleNoAnswer = () => {
    if (!activeCall) return;
    const logMessage: Message = {
      id: Date.now().toString(),
      senderId: 'system',
      senderName: 'System',
      isCallLog: true,
      callDuration: '0:00',
      text: t('call_log_no_answer'),
      timestamp: new Date()
    };
    setChats(prev => prev.map(c => 
      c.id === activeCall.chatId ? { ...c, messages: [...c.messages, logMessage] } : c
    ));
    setActiveCall(null);
    setCallTimer(0);
  };

  const handleEndCall = () => {
    if (!activeCall || !currentUser) return;
    if (ringingTimeoutRef.current) {
      clearTimeout(ringingTimeoutRef.current);
      ringingTimeoutRef.current = null;
    }
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch {}
      sessionRef.current = null;
    }
    if (audioContextsRef.current.input) audioContextsRef.current.input.close();
    if (audioContextsRef.current.output) audioContextsRef.current.output.close();
    audioContextsRef.current = {};
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    const duration = activeCall.status === 'active' ? `${Math.floor(callTimer / 60)}:${(callTimer % 60).toString().padStart(2, '0')}` : null;
    const logMessage: Message = {
      id: Date.now().toString(),
      senderId: 'system',
      senderName: 'System',
      isCallLog: true,
      callDuration: duration || '0:00',
      timestamp: new Date()
    };
    setChats(prev => prev.map(c => 
      c.id === activeCall.chatId ? { ...c, messages: [...c.messages, logMessage] } : c
    ));
    setActiveCall(null);
    setCallTimer(0);
    setCallTranscription('');
  };

  const handleToggleBlockUser = (userId: string) => {
    saveUsersToStorage(registeredUsers.map(u => u.id === userId ? { ...u, isBlocked: !u.isBlocked } : u));
  };

  const handleCreateChat = () => {
    if (!newName.trim() || !currentUser || !showCreateModal) return;
    const newChat: Chat = {
      id: Math.random().toString(36).substr(2, 9),
      name: newName.trim(),
      handle: newHandle ? `@${newHandle.replace('@', '')}` : undefined,
      type: showCreateModal,
      participants: [currentUser.id],
      messages: [],
      creatorId: currentUser.id
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setShowCreateModal(null);
    setNewName('');
    setNewHandle('');
  };

  const startDirectChat = (partner: User) => {
    if (!currentUser) return;
    const existing = chats.find(c => c.type === 'direct' && c.participants.includes(partner.id));
    if (existing) {
      setActiveChatId(existing.id);
    } else {
      const newChat: Chat = {
        id: `direct-${currentUser.id}-${partner.id}`,
        name: partner.name,
        type: 'direct',
        participants: [currentUser.id, partner.id],
        messages: [],
        creatorId: currentUser.id
      };
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(newChat.id);
    }
    setChatSearchQuery('');
  };

  const joinGlobalChat = (chat: Chat) => {
    if (!currentUser) return;
    setChats(prev => prev.map(c => 
      c.id === chat.id ? { ...c, participants: [...c.participants, currentUser.id] } : c
    ));
    setActiveChatId(chat.id);
    setChatSearchQuery('');
  };

  const handleSummarize = async () => {
    if (activeChat && activeChat.messages.length > 1) {
      setIsTyping(true);
      try {
        const res = await summarizeConversation(activeChat.messages);
        setSummary(res);
      } catch (err) { console.error(err); } 
      finally { setIsTyping(false); }
    }
  };

  const isModerator = currentUser?.role === 'developer' || currentUser?.role === 'admin';

  const getThemeClasses = () => {
    switch(currentUser?.theme) {
      case 'light': return 'bg-white text-slate-900';
      case 'midnight': return 'bg-black text-indigo-100';
      default: return 'bg-slate-950 text-slate-100';
    }
  };

  const getCardClasses = () => {
    const base = 'border transition-colors duration-300 rounded-3xl p-6 md:p-8 ';
    switch(currentUser?.theme) {
      case 'light': return base + 'bg-slate-50 border-slate-200 shadow-sm';
      case 'midnight': return base + 'bg-slate-900 border-indigo-900/50 shadow-2xl shadow-indigo-500/10';
      default: return base + 'bg-slate-900 border-slate-800 shadow-xl';
    }
  };

  if (activeView === FluxurView.AUTH) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-slate-950 p-6 font-inter text-white">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95">
          <div className="flex flex-col items-center mb-8 text-center">
            <ICONS.Logo className="w-24 h-24 mb-4 drop-shadow-[0_0_15px_rgba(34,211,238,0.3)]" />
            <h1 className="text-3xl font-outfit font-bold">{t('appName')}</h1>
            <p className="text-slate-400 text-sm mt-1">{t('tagline')}</p>
          </div>
          <div className="space-y-4">
            {authMode === 'register' && (
              <input type="text" placeholder={t('auth_name')} className="w-full bg-slate-800 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} />
            )}
            <input type="text" placeholder={t('auth_login')} className="w-full bg-slate-800 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.login} onChange={e => setAuthForm({...authForm, login: e.target.value})} />
            <input type="password" placeholder={t('auth_pass')} className="w-full bg-slate-800 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} />
            {authError && <p className="text-red-400 text-xs text-center">{authError}</p>}
            <button onClick={handleAuth} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl shadow-lg transition-all">{authMode === 'login' ? t('auth_btn_login') : t('auth_btn_register')}</button>
            <p className="text-slate-500 text-xs text-center cursor-pointer" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? t('auth_switch_to_reg') : t('auth_switch_to_login')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-colors duration-300 ${getThemeClasses()}`}>
      {/* Real Call Overlay */}
      {activeCall && (
        <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center p-8 animate-in fade-in duration-500">
          <div className="relative mb-12">
            <div className={`absolute inset-0 bg-indigo-500/20 rounded-full animate-ping ${activeCall.status === 'ringing' ? 'animation-duration-1000' : ''}`}></div>
            <div className={`w-32 h-32 rounded-full border-4 ${activeCall.status === 'active' ? 'border-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.3)]' : 'border-indigo-500'} p-1 relative z-10 transition-colors duration-500`}>
              <div className="w-full h-full bg-slate-800 rounded-full flex items-center justify-center overflow-hidden">
                <span className="text-4xl font-bold">{activeChat?.name[0]}</span>
              </div>
            </div>
          </div>
          <h2 className="text-3xl font-bold mb-2">{activeChat?.name}</h2>
          <p className={`font-medium tracking-widest uppercase text-sm mb-4 transition-colors ${activeCall.status === 'active' ? 'text-emerald-400' : 'text-indigo-400'}`}>
            {activeCall.status === 'ringing' ? t('call_ringing') : `${t('call_active')} • ${Math.floor(callTimer / 60)}:${(callTimer % 60).toString().padStart(2, '0')}`}
          </p>
          <div className="h-24 w-full max-w-lg overflow-y-auto mb-12 px-6">
            <p className="text-slate-400 text-center italic text-sm animate-in fade-in slide-in-from-bottom-2">
              {callTranscription || "..."}
            </p>
          </div>
          <div className="flex gap-8">
            <button className="w-16 h-16 bg-slate-800 hover:bg-slate-700 rounded-full flex items-center justify-center transition-colors">
              <ICONS.Clip className="w-6 h-6 text-white" />
            </button>
            <button onClick={handleEndCall} className="w-16 h-16 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center transition-all hover:scale-110 shadow-2xl shadow-red-500/20">
              <ICONS.Phone className="w-8 h-8 text-white rotate-[135deg]" />
            </button>
            <button className="w-16 h-16 bg-slate-800 hover:bg-slate-700 rounded-full flex items-center justify-center transition-colors">
              <ICONS.User className="w-6 h-6 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar Rail */}
      <nav className={`w-20 border-r flex flex-col items-center py-8 gap-6 shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentUser?.theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-slate-900 border-slate-800'}`}>
        <div className="w-12 h-12 cursor-pointer hover:scale-110 transition-transform mb-4" onClick={() => setActiveView(FluxurView.CHATS)}><ICONS.Logo /></div>
        <button onClick={() => setActiveView(FluxurView.CHATS)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.CHATS ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-indigo-400'}`} title={t('sidebar_chats')}><ICONS.Message /></button>
        <button onClick={() => setActiveView(FluxurView.PROFILE)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.PROFILE ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-indigo-400'}`} title={t('sidebar_profile')}><ICONS.User /></button>
        {isModerator && <button onClick={() => setActiveView(FluxurView.ADMIN)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.ADMIN ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'text-slate-500 hover:text-amber-400'}`} title={t('sidebar_admin')}><ICONS.Sparkles /></button>}
        <div className="flex-1" />
        <button onClick={() => setActiveView(FluxurView.SETTINGS)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.SETTINGS ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-500 hover:text-indigo-400'}`} title={t('sidebar_settings')}><ICONS.Settings /></button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activeView === FluxurView.CHATS ? (
          <>
            <aside className={`w-full md:w-80 border-r flex flex-col shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentUser?.theme === 'light' ? 'bg-slate-50' : 'bg-slate-900/50'}`}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-outfit font-bold">{t('appName')}</h2>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCreateModal('group')} className="p-2 hover:bg-slate-800 rounded-lg text-indigo-400 transition-colors"><ICONS.Plus className="w-4 h-4" /></button>
                    <button onClick={() => setShowCreateModal('channel')} className="p-2 hover:bg-slate-800 rounded-lg text-emerald-400 transition-colors"><ICONS.Message className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="relative mb-6">
                  <ICONS.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" placeholder={t('chat_search')} className={`w-full text-xs py-2.5 pl-10 pr-4 rounded-xl border outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${currentUser?.theme === 'light' ? 'bg-slate-100 border-slate-200 text-slate-900' : 'bg-slate-800 border-slate-700 text-slate-100'}`} value={chatSearchQuery} onChange={(e) => setChatSearchQuery(e.target.value)} />
                </div>
                <div className="space-y-4 overflow-y-auto">
                  {searchResults.myChats.map(chat => (
                    <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`p-4 rounded-2xl cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600/10 border-indigo-500/30' : 'hover:bg-indigo-500/5 border-transparent'}`}>
                      <span className="font-bold text-sm truncate block">{chat.name}</span>
                      <p className="text-[10px] text-indigo-400/60 truncate mb-1">{chat.handle || ''}</p>
                      <p className="text-xs text-slate-500 truncate">{chat.lastMessage || t('msg_no_messages')}</p>
                    </div>
                  ))}
                  {searchResults.globalUsers.map(u => (
                    <div key={u.id} onClick={() => startDirectChat(u)} className="p-3 rounded-2xl cursor-pointer hover:bg-slate-800 transition-all flex items-center gap-3">
                      <img src={u.avatar} className="w-8 h-8 rounded-full shadow-sm" />
                      <div className="truncate"><p className="font-bold text-sm truncate">{u.name}</p><p className="text-[10px] text-slate-500">@{u.login}</p></div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
            <main className={`flex-1 flex-col ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
              {activeChat ? (
                <>
                  <header className="h-20 border-b px-4 md:px-8 flex items-center justify-between backdrop-blur-md">
                    <div className="flex items-center gap-2 md:gap-4 flex-1">
                      <button onClick={() => setActiveChatId(null)} className="md:hidden p-2 hover:bg-slate-800 rounded-lg text-slate-400"><ICONS.Back className="w-6 h-6" /></button>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 shadow-lg ${activeChat.type === 'channel' ? 'bg-emerald-600 shadow-emerald-500/20' : 'bg-indigo-600 shadow-indigo-500/20'}`}>{activeChat.name[0]}</div>
                      <div className="truncate"><h3 className="font-semibold truncate text-sm md:text-base">{activeChat.name}</h3><p className="text-[10px] text-slate-500">{activeChat.handle || activeChat.type.toUpperCase()}</p></div>
                    </div>
                    <div className="flex items-center gap-4">
                      {(activeChat.type === 'direct' || activeChat.type === 'ai') && <button onClick={handleStartCall} className="p-2 hover:bg-indigo-500/10 rounded-lg text-indigo-400 transition-all active:scale-95"><ICONS.Phone className="w-4 h-4" /></button>}
                      {activeChat.type === 'ai' && <button onClick={handleSummarize} className="text-xs font-bold text-indigo-400 uppercase tracking-tighter hover:underline">{t('chat_summary')}</button>}
                    </div>
                  </header>
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
                    {summary && <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl mb-4 italic text-sm text-indigo-300">"{summary}"</div>}
                    {filteredMessages.map(m => (
                      <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : m.senderId === 'system' ? 'justify-center' : 'justify-start'}`}>
                        {m.isCallLog ? (
                          <div className="flex flex-col items-center gap-1 bg-slate-900/50 border border-slate-800 px-4 py-2 rounded-full text-[10px] text-slate-500">
                             <div className="flex items-center gap-2">
                               <ICONS.Phone className={`w-3 h-3 ${m.callDuration === '0:00' ? 'text-red-500' : 'text-emerald-500'}`} />
                               <span className="font-bold uppercase tracking-widest">{m.callDuration === '0:00' ? (m.text || t('call_log_missed')) : t('call_log_ended')}</span>
                             </div>
                             {m.callDuration !== '0:00' && <span>{t('call_duration')}: {m.callDuration}</span>}
                          </div>
                        ) : (
                          <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-2xl shadow-md ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white' : (currentUser?.theme === 'light' ? 'bg-slate-100 border border-slate-200 text-slate-900' : 'bg-slate-800 text-slate-100')}`}>
                            {m.senderId !== currentUser?.id && <p className="text-[10px] opacity-50 mb-1 font-bold">{m.senderName}</p>}
                            {m.text && <p className="text-sm whitespace-pre-wrap">{m.text}</p>}
                            <p className="text-[9px] mt-2 opacity-40 text-right">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <footer className="p-4 md:p-6">
                    <div className={`border rounded-2xl p-2 flex items-center gap-2 ${currentUser?.theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-slate-900 border-slate-800'}`}>
                      <textarea rows={1} value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} placeholder={t('chat_input_placeholder')} className="flex-1 bg-transparent border-none outline-none px-4 py-2 resize-none text-sm" />
                      <button onClick={() => handleSendMessage()} className="p-3 bg-indigo-600 text-white rounded-xl shadow-lg transition-transform active:scale-95"><ICONS.Send className="w-5 h-5" /></button>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-600 p-6 text-center">
                  <ICONS.Logo className="w-32 h-32 mb-4 opacity-20 grayscale" />
                  <p className="font-outfit font-bold text-xl">{t('appName')} Messenger</p>
                  <p className="text-sm opacity-50 mt-1">{t('chat_no_select')}</p>
                </div>
              )}
            </main>
          </>
        ) : activeView === FluxurView.ADMIN ? (
          <div className="flex-1 p-8 md:p-12 max-w-5xl mx-auto space-y-12 overflow-y-auto">
            <h1 className="text-4xl font-outfit font-black text-amber-500">{t('admin_title')}</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {registeredUsers.map(u => (
                  <div key={u.id} className={getCardClasses()}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <img src={u.avatar} className={`w-12 h-12 rounded-full border-2 ${u.isBlocked ? 'grayscale border-red-500' : 'border-emerald-500'}`} />
                        <div><p className="font-bold text-base">{u.name}</p><p className="text-xs text-slate-500">@{u.login}</p></div>
                      </div>
                      <button onClick={() => handleToggleBlockUser(u.id)} className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${u.isBlocked ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/20'}`}>{u.isBlocked ? t('admin_unblock') : t('admin_block')}</button>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        ) : activeView === FluxurView.PROFILE ? (
          <div className="flex-1 p-8 md:p-12 max-w-2xl mx-auto space-y-12 overflow-y-auto animate-in fade-in slide-in-from-bottom-6 duration-500">
            <h1 className="text-4xl font-outfit font-black">{t('profile_title')}</h1>
            <div className={getCardClasses() + " flex-col md:flex-row flex items-center gap-8"}>
              <div className="relative group">
                <img src={currentUser?.avatar} className="w-32 h-32 rounded-3xl shadow-2xl transition-transform group-hover:scale-105" />
                <div className={`absolute -bottom-2 -right-2 w-6 h-6 rounded-full border-4 border-slate-900 ${currentUser?.status === 'online' ? 'bg-emerald-500' : 'bg-slate-500'}`}></div>
              </div>
              <div className="text-center md:text-left">
                <h2 className="text-3xl font-bold mb-1">{currentUser?.name}</h2>
                <p className="text-slate-500 font-medium mb-4">@{currentUser?.login}</p>
                <div className="flex gap-2 justify-center md:justify-start">
                  {currentUser?.isPremium && <span className="bg-amber-400 text-amber-950 text-[10px] font-black px-3 py-1 rounded-full uppercase shadow-lg shadow-amber-500/20">PREMIUM</span>}
                  {currentUser?.role === 'developer' && <span className="bg-indigo-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase shadow-lg shadow-indigo-500/20">DEVELOPER</span>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className={getCardClasses() + " p-6 text-center"}>
                <p className="text-2xl font-bold">{chats.length}</p>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{t('sidebar_chats')}</p>
              </div>
              <div className={getCardClasses() + " p-6 text-center"}>
                <p className="text-2xl font-bold">{currentUser?.language?.toUpperCase()}</p>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{t('settings_language')}</p>
              </div>
            </div>

            <div className="space-y-4">
              <button 
                onClick={() => {
                  setCurrentUser(null); 
                  setActiveChatId(null); 
                  setActiveView(FluxurView.AUTH);
                }} 
                className="w-full p-5 bg-red-600/10 text-red-500 rounded-2xl font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all shadow-lg active:scale-95"
              >
                {t('profile_logout')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-8 md:p-12 max-w-2xl mx-auto space-y-12 overflow-y-auto animate-in fade-in slide-in-from-right-6 duration-500">
             <h1 className="text-4xl font-outfit font-black">{t('settings_title')}</h1>
             
             <section className="space-y-6">
                <h3 className="text-xl font-bold border-b border-slate-800 pb-2">{t('settings_language')}</h3>
                <div className="grid grid-cols-2 gap-4">
                   {[
                     { code: 'ru', label: 'Русский' },
                     { code: 'en', label: 'English' }
                   ].map(l => (
                     <button 
                       key={l.code} 
                       onClick={() => updateCurrentUser({ language: l.code as any })} 
                       className={`py-5 rounded-3xl border-2 font-black uppercase tracking-widest transition-all ${currentUser?.language === l.code ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl shadow-indigo-500/20' : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:border-slate-700'}`}
                      >
                        {l.label}
                      </button>
                   ))}
                </div>
             </section>

             <section className="space-y-6">
                <h3 className="text-xl font-bold border-b border-slate-800 pb-2">{t('settings_theme')}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   {[
                     { id: 'dark', label: 'Dark', color: 'bg-slate-900' },
                     { id: 'light', label: 'Light', color: 'bg-slate-100' },
                     { id: 'midnight', label: 'Midnight', color: 'bg-black' }
                   ].map(theme => (
                     <button 
                        key={theme.id} 
                        onClick={() => updateCurrentUser({ theme: theme.id as any })} 
                        className={`group relative py-8 rounded-3xl border-2 font-black uppercase tracking-widest transition-all flex flex-col items-center gap-3 overflow-hidden ${currentUser?.theme === theme.id ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl shadow-indigo-500/20' : 'bg-slate-900/40 border-slate-800 text-slate-500 hover:border-slate-700'}`}
                      >
                        <div className={`w-8 h-8 rounded-full border-2 border-white/10 ${theme.color}`}></div>
                        {theme.label}
                      </button>
                   ))}
                </div>
             </section>

             <section className="space-y-6">
                <h3 className="text-xl font-bold border-b border-slate-800 pb-2">{t('settings_premium')}</h3>
                <div className={getCardClasses()}>
                   <p className="text-slate-400 text-sm mb-6 leading-relaxed">{t('settings_premium_desc')}</p>
                   {currentUser?.premiumStatus === 'active' ? (
                     <div className="flex items-center gap-2 text-emerald-500 font-black uppercase tracking-tighter">
                       <ICONS.Sparkles className="w-5 h-5" />
                       {t('settings_premium_active')}
                     </div>
                   ) : (
                     <button 
                        onClick={() => updateCurrentUser({ premiumStatus: 'active', isPremium: true })} 
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 px-10 rounded-2xl shadow-xl transition-all active:scale-95 w-full md:w-auto"
                      >
                        {t('settings_premium_get')}
                      </button>
                   )}
                </div>
             </section>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-2xl font-outfit font-bold mb-6">{showCreateModal === 'channel' ? t('modal_create_channel') : t('modal_create_chat')}</h3>
            <div className="space-y-4 mb-8">
              <input type="text" placeholder={t('modal_name_placeholder')} className="w-full bg-slate-800 rounded-2xl py-4 px-5 outline-none focus:ring-2 focus:ring-indigo-500 text-white" value={newName} onChange={e => setNewName(e.target.value)} />
              <input type="text" placeholder={t('modal_handle_placeholder')} className="w-full bg-slate-800 rounded-2xl py-4 px-5 outline-none focus:ring-2 focus:ring-indigo-500 text-white" value={newHandle} onChange={e => setNewHandle(e.target.value)} />
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowCreateModal(null)} className="flex-1 py-4 text-slate-500 font-bold hover:text-white transition-colors">{t('modal_cancel')}</button>
              <button onClick={handleCreateChat} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-500/20 active:scale-95 transition-transform">{t('modal_create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
