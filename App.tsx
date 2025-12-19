
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView, FileAttachment } from './types';
import { ICONS, COLORS } from './constants';
import { translations } from './translations';
import { chatWithAssistant, summarizeConversation } from './geminiService';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';

// --- Gun.js Global Instance ---
// База v3 для чистого старта и глобальной синхронизации P2P
const gun = (window as any).Gun(['https://gun-manhattan.herokuapp.com/gun', 'https://fluxur-relay.herokuapp.com/gun']);
const db = gun.get('fluxur_messenger_v3');

// --- Default Avatar SVG as Base64 ---
const DEFAULT_AVATAR = "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2I5YmRiZCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDAiIHI9IjIxIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjMiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMjAgOTAgQzIwIDYwIDgwIDYwIDgwIDkwIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjMiIGZpbGw9Im5vbmUiLz48L3N2Zz4=";

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
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileAvatarRef = useRef<HTMLInputElement>(null);

  const [newHandle, setNewHandle] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState<'group' | 'channel' | null>(null);
  const [newName, setNewName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', login: '', password: '', avatar: DEFAULT_AVATAR });
  const [authError, setAuthError] = useState('');

  // --- Global Synchronization Logic ---
  useEffect(() => {
    // Синхронизация списка всех пользователей для входа (P2P)
    db.get('users').map().on((data: any) => {
      if (data && data.id) {
        setRegisteredUsers(prev => {
          const filtered = prev.filter(u => u.id !== data.id);
          return [...filtered, data];
        });
      }
    });

    // Синхронизация чатов
    db.get('chats').map().on((data: any) => {
      if (data && data.id) {
        try {
          const parsedChat: Chat = {
            ...data,
            participants: JSON.parse(data.participants || '[]'),
            messages: JSON.parse(data.messages || '[]')
          };
          setChats(prev => {
            const filtered = prev.filter(c => c.id !== parsedChat.id);
            return [...filtered, parsedChat];
          });
        } catch (e) {
          console.error("Failed to parse chat data", e);
        }
      }
    });

    // Восстановление сессии из локального хранилища
    const savedSession = localStorage.getItem('fluxur_session_v3');
    if (savedSession) {
      setCurrentUser(JSON.parse(savedSession));
      setActiveView(FluxurView.CHATS);
    }
  }, []);

  // Обновление локальной сессии при смене пользователя
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('fluxur_session_v3', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('fluxur_session_v3');
    }
  }, [currentUser]);

  const lang = currentUser?.language || 'ru';
  const t = (key: keyof typeof translations['ru']) => (translations[lang] || translations['ru'])[key] || key;

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  // Фильтр только своих чатов (глобальный поиск отключен по просьбе)
  const myChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter(c => c.participants.includes(currentUser.id));
  }, [chats, currentUser]);

  const searchResults = useMemo(() => {
    const q = chatSearchQuery.toLowerCase().trim();
    if (!q) return myChats;
    return myChats.filter(c => 
      c.name.toLowerCase().includes(q) || (c.handle && c.handle.toLowerCase().includes(q))
    );
  }, [myChats, chatSearchQuery]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeChat?.messages, isTyping]);

  // Fix: Added missing updateCurrentUser function to fix errors on lines 483 and 486
  const updateCurrentUser = (updates: Partial<User>) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, ...updates };
    setCurrentUser(updatedUser);
    db.get('users').get(currentUser.id).put(updates);
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
        password: authForm.password,
        avatar: authForm.avatar || DEFAULT_AVATAR,
        status: 'online',
        isPremium: isDev, 
        premiumStatus: isDev ? 'active' : 'none',
        role: isDev ? 'developer' : 'user',
        theme: 'dark',
        language: 'ru',
        isBlocked: false
      };
      
      db.get('users').get(newUser.id).put(newUser);
      setCurrentUser(newUser);
      setActiveView(FluxurView.CHATS);
    } else {
      const user = registeredUsers.find(u => u.login.toLowerCase() === normalizedLogin.toLowerCase() && u.password === authForm.password);
      if (user) {
        if (user.isBlocked) {
          setAuthError(t('auth_err_blocked'));
          return;
        }
        setCurrentUser(user);
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
          db.get('chats').get(newAiChat.id).put({
            ...newAiChat,
            participants: JSON.stringify(newAiChat.participants),
            messages: JSON.stringify(newAiChat.messages)
          });
        }
      } else {
        setAuthError(t('auth_err_invalid'));
      }
    }
  };

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>, isProfileUpdate: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      if (isProfileUpdate) {
        // Fix: Use the new updateCurrentUser helper
        updateCurrentUser({ avatar: base64 });
      } else {
        setAuthForm(prev => ({ ...prev, avatar: base64 }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = useCallback(async (file?: FileAttachment) => {
    if ((!inputText.trim() && !file) || !currentUser || !activeChat) return;
    if (activeChat.isBlocked) return;

    const currentText = inputText;
    const currentChatId = activeChat.id;
    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: currentText,
      timestamp: new Date(),
      file: file
    };

    const updatedMessages = [...activeChat.messages, newMessage];
    db.get('chats').get(currentChatId).put({
      messages: JSON.stringify(updatedMessages),
      lastMessage: file ? `File: ${file.name}` : currentText
    });

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
        const messagesWithAi = [...updatedMessages, aiMessage];
        db.get('chats').get(currentChatId).put({
          messages: JSON.stringify(messagesWithAi),
          lastMessage: response
        });
      } catch (err) {
        console.error(err);
      } finally {
        setIsTyping(false);
      }
    }
  }, [inputText, activeChat, currentUser]);

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
    
    db.get('chats').get(newChat.id).put({
      ...newChat,
      participants: JSON.stringify(newChat.participants),
      messages: JSON.stringify(newChat.messages)
    });

    setActiveChatId(newChat.id);
    setShowCreateModal(null);
    setNewName('');
    setNewHandle('');
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
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 relative overflow-hidden">
          <div className="flex flex-col items-center mb-8 text-center relative z-10">
            <ICONS.Logo className="w-20 h-20 mb-4 drop-shadow-[0_0_15px_rgba(34,211,238,0.3)]" />
            <h1 className="text-3xl font-outfit font-bold">{t('appName')}</h1>
            <p className="text-slate-400 text-sm mt-1">{t('tagline')}</p>
          </div>
          
          <div className="space-y-5 relative z-10">
            {authMode === 'register' && (
              <div className="flex flex-col items-center mb-4">
                <input 
                  type="file" 
                  ref={avatarInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={(e) => handleAvatarSelect(e)} 
                />
                <div 
                  onClick={(e) => { e.stopPropagation(); avatarInputRef.current?.click(); }} 
                  className="w-24 h-24 rounded-full border-4 border-slate-800 bg-slate-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-indigo-500 transition-all group shadow-2xl relative"
                >
                  <img src={authForm.avatar} className="w-full h-full object-cover" alt="Avatar Preview" />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <ICONS.Plus className="w-8 h-8 text-white" />
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 uppercase font-black mt-2 tracking-widest">{t('auth_avatar_select')}</p>
              </div>
            )}
            
            <div className="space-y-4">
              {authMode === 'register' && (
                <input 
                  type="text" 
                  placeholder={t('auth_name')} 
                  className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-white" 
                  value={authForm.name} 
                  onChange={e => setAuthForm({...authForm, name: e.target.value})} 
                />
              )}
              
              <input 
                type="text" 
                placeholder={t('auth_login')} 
                className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-white" 
                value={authForm.login} 
                onChange={e => setAuthForm({...authForm, login: e.target.value})} 
              />
              
              <input 
                type="password" 
                placeholder={t('auth_pass')} 
                className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-white" 
                value={authForm.password} 
                onChange={e => setAuthForm({...authForm, password: e.target.value})} 
              />
            </div>

            {authError && <p className="text-red-400 text-xs text-center animate-pulse">{authError}</p>}
            
            <button 
              onClick={handleAuth} 
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl shadow-lg transition-all active:scale-95"
            >
              {authMode === 'login' ? t('auth_btn_login') : t('auth_btn_register')}
            </button>
            
            <p className="text-slate-500 text-xs text-center cursor-pointer hover:text-indigo-400 transition-colors py-2" onClick={() => {
              setAuthMode(authMode === 'login' ? 'register' : 'login');
              setAuthError('');
            }}>
              {authMode === 'login' ? t('auth_switch_to_reg') : t('auth_switch_to_login')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-colors duration-300 ${getThemeClasses()}`}>
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
              <div className="p-6 h-full flex flex-col">
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
                <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                  {searchResults.length > 0 ? searchResults.map(chat => (
                    <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`p-4 rounded-2xl cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600/10 border-indigo-500/30' : 'hover:bg-indigo-500/5 border-transparent'}`}>
                      <span className="font-bold text-sm truncate block">{chat.name}</span>
                      <p className="text-xs text-slate-500 truncate">{chat.lastMessage || t('msg_no_messages')}</p>
                    </div>
                  )) : (
                    <p className="text-center text-slate-500 text-xs mt-10">{t('chat_empty')}</p>
                  )}
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
                  </header>
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
                    {activeChat.messages.map(m => (
                      <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-2xl shadow-md ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white' : (currentUser?.theme === 'light' ? 'bg-slate-100 border border-slate-200 text-slate-900' : 'bg-slate-800 text-slate-100')}`}>
                          {m.senderId !== currentUser?.id && <p className="text-[10px] opacity-50 mb-1 font-bold">{m.senderName}</p>}
                          {m.text && <p className="text-sm whitespace-pre-wrap">{m.text}</p>}
                          <p className="text-[9px] mt-2 opacity-40 text-right">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    ))}
                    {isTyping && <div className="text-xs text-slate-500 italic">{t('chat_typing')}...</div>}
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
        ) : activeView === FluxurView.PROFILE ? (
          <div className="flex-1 p-8 md:p-12 max-w-2xl mx-auto space-y-12 overflow-y-auto">
            <h1 className="text-4xl font-outfit font-black">{t('profile_title')}</h1>
            <div className={getCardClasses() + " flex-col md:flex-row flex items-center gap-8"}>
              <div className="relative group cursor-pointer" onClick={() => profileAvatarRef.current?.click()}>
                <input type="file" ref={profileAvatarRef} className="hidden" accept="image/*" onChange={(e) => handleAvatarSelect(e, true)} />
                <img src={currentUser?.avatar || DEFAULT_AVATAR} className="w-32 h-32 rounded-3xl shadow-2xl transition-transform group-hover:scale-105 object-cover" alt="Profile" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl flex items-center justify-center flex-col gap-2">
                   <ICONS.Plus className="w-8 h-8 text-white" />
                   <p className="text-[10px] font-black text-white uppercase tracking-widest">{t('profile_change_photo')}</p>
                </div>
              </div>
              <div className="text-center md:text-left">
                <h2 className="text-3xl font-bold mb-1">{currentUser?.name}</h2>
                <p className="text-slate-500 font-medium">@{currentUser?.login}</p>
              </div>
            </div>
            <button onClick={() => { setCurrentUser(null); setActiveView(FluxurView.AUTH); }} className="w-full p-5 bg-red-600/10 text-red-500 rounded-2xl font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all shadow-lg active:scale-95">{t('profile_logout')}</button>
          </div>
        ) : (
          <div className="flex-1 p-8 md:p-12 max-w-2xl mx-auto space-y-12 overflow-y-auto text-center">
             <h1 className="text-4xl font-outfit font-black mb-10">{t('settings_title')}</h1>
             <div className="flex flex-col gap-4 mt-8">
                <button onClick={() => updateCurrentUser({ theme: currentUser?.theme === 'light' ? 'dark' : 'light' })} className="p-4 bg-slate-800 rounded-2xl hover:bg-indigo-600 transition-colors">
                  {t('settings_theme')}: {currentUser?.theme === 'light' ? 'Light' : 'Dark'}
                </button>
                <button onClick={() => updateCurrentUser({ language: currentUser?.language === 'ru' ? 'en' : 'ru' })} className="p-4 bg-slate-800 rounded-2xl hover:bg-indigo-600 transition-colors">
                  {t('settings_language')}: {currentUser?.language === 'ru' ? 'Русский' : 'English'}
                </button>
             </div>
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
