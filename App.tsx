
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView, FileAttachment } from './types';
import { ICONS, COLORS } from './constants';
import { translations } from './translations';
import { chatWithAssistant, summarizeConversation } from './geminiService';

// --- Конфигурация Gun.js ---
const gun = (window as any).Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us-west.herokuapp.com/gun',
  'https://gun-eu-west.herokuapp.com/gun',
  'https://fluxur-relay-p2p.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://dletta.herokuapp.com/gun',
  'https://gunjs.herokuapp.com/gun'
]);

const APP_DB_KEY = 'fluxur_v7_final_release';
const SESSION_STORAGE_KEY = 'fluxur_v7_user_session';
const db = gun.get(APP_DB_KEY);

const DEFAULT_AVATAR = "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMTAwIDEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2I5YmRiZCIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNDAiIHI9IjIxIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjMiIGZpbGw9Im5vbmUiLz48cGF0aCBkPSJNMjAgOTAgQzIwIDYwIDgwIDYwIDgwIDkwIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjMiIGZpbGw9Im5vbmUiLz48L3N2Zz4=";
const DEVELOPER_LOGIN = 'stephan_rogovoy';

const THEMES = {
  dark: 'bg-slate-950 text-slate-100',
  light: 'bg-slate-50 text-slate-900',
  midnight: 'bg-black text-indigo-400',
  forest: 'bg-emerald-950 text-emerald-100',
  sunset: 'bg-orange-950 text-orange-100'
};

const NAV_THEMES = {
  dark: 'bg-slate-900 border-slate-800',
  light: 'bg-white border-slate-200',
  midnight: 'bg-zinc-950 border-indigo-900',
  forest: 'bg-green-950 border-emerald-900',
  sunset: 'bg-red-950 border-orange-900'
};

export default function App() {
  // Мгновенная загрузка сессии при инициализации состояния
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const [activeView, setActiveView] = useState<FluxurView>(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    return saved ? FluxurView.CHATS : FluxurView.AUTH;
  });

  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isSyncing, setIsSyncing] = useState(true);
  const [showModModal, setShowModModal] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);

  const [newHandle, setNewHandle] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState<'group' | 'channel' | null>(null);
  const [newName, setNewName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', login: '', password: '', avatar: DEFAULT_AVATAR });
  const [authError, setAuthError] = useState('');

  // --- Глобальная синхронизация данных ---
  useEffect(() => {
    // Подписка на индекс пользователей
    db.get('user_directory').map().on((userId: string) => {
      if (userId) {
        db.get('users').get(userId).on((userData: any) => {
          if (userData && userData.id) {
            setRegisteredUsers(prev => {
              const filtered = prev.filter(u => u.id !== userData.id);
              return [...filtered, userData];
            });
            // Если это данные текущего пользователя, обновляем их (фоновая синхронизация)
            if (currentUser && userData.id === currentUser.id) {
              const updated = { ...userData };
              setCurrentUser(updated);
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
            }
            setIsSyncing(false);
          }
        });
      }
    });

    // Подписка на индекс чатов
    db.get('chat_directory').map().on((chatId: string) => {
      if (chatId) {
        db.get('chats').get(chatId).on((chatData: any) => {
          if (chatData && chatData.id) {
            try {
              const parsedChat: Chat = {
                ...chatData,
                participants: JSON.parse(chatData.participants || '[]'),
                bannedUsers: JSON.parse(chatData.bannedUsers || '{}'),
                messages: JSON.parse(chatData.messages || '[]')
              };
              setChats(prev => {
                const filtered = prev.filter(c => c.id !== parsedChat.id);
                return [...filtered, parsedChat];
              });
            } catch (e) { console.error("Sync error", e); }
          } else if (chatData === null) {
            setChats(prev => prev.filter(c => c.id !== chatId));
          }
        });
      }
    });

    setTimeout(() => setIsSyncing(false), 4000);
  }, []);

  const langCode = currentUser?.language || 'ru';
  const t = (key: string) => {
    const set = translations[langCode] || translations['en'] || translations['ru'];
    return set[key] || key;
  };

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  const myChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter(c => {
      const isDev = currentUser.role === 'developer';
      if (c.isBlocked && !isDev) return false;
      const isParticipant = c.participants.includes(currentUser.id);
      const banExpiry = c.bannedUsers?.[currentUser.id] || 0;
      return isParticipant && banExpiry < Date.now();
    });
  }, [chats, currentUser]);

  const searchResults = useMemo(() => {
    const q = chatSearchQuery.toLowerCase().trim();
    if (!q) return myChats;
    return myChats.filter(c => c.name.toLowerCase().includes(q) || c.handle?.toLowerCase().includes(q));
  }, [myChats, chatSearchQuery]);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAuthForm(prev => ({ ...prev, avatar: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  const handleProfileAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && currentUser) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        updateSetting('avatar', base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAuth = async () => {
    setAuthError('');
    const normalizedLogin = authForm.login.trim().toLowerCase();
    
    if (authMode === 'register') {
      if (!authForm.login || !authForm.password || !authForm.name) {
        setAuthError(t('auth_err_fields'));
        return;
      }

      db.get('aliases').get(normalizedLogin).once((userId: string) => {
        if (userId) {
          setAuthError(t('auth_err_taken'));
        } else {
          const isDev = normalizedLogin === DEVELOPER_LOGIN;
          const newUser: User = {
            id: Math.random().toString(36).substr(2, 9),
            name: authForm.name,
            login: normalizedLogin,
            password: authForm.password,
            avatar: authForm.avatar || DEFAULT_AVATAR,
            status: 'online',
            isPremium: isDev,
            role: isDev ? 'developer' : 'user',
            theme: 'dark',
            language: 'ru',
            isBlocked: false
          };
          
          db.get('users').get(newUser.id).put(newUser, (ack: any) => {
            if (!ack.err) {
              db.get('aliases').get(normalizedLogin).put(newUser.id);
              db.get('user_directory').get(newUser.id).put(newUser.id);
              setCurrentUser(newUser);
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newUser));
              setActiveView(FluxurView.CHATS);
            } else {
              setAuthError("Network error: " + ack.err);
            }
          });
        }
      });
    } else {
      db.get('aliases').get(normalizedLogin).once((userId: string) => {
        if (userId) {
          db.get('users').get(userId).once((user: any) => {
            if (user && user.password === authForm.password) {
              if (user.isBlocked && normalizedLogin !== DEVELOPER_LOGIN) {
                setAuthError(t('auth_err_blocked'));
                return;
              }
              setCurrentUser(user);
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
              setActiveView(FluxurView.CHATS);
            } else {
              setAuthError(t('auth_err_invalid'));
            }
          });
        } else {
          setAuthError(t('auth_err_invalid'));
        }
      });
    }
  };

  const updateSetting = (key: keyof User, value: any) => {
    if (!currentUser) return;
    const updated = { ...currentUser, [key]: value };
    setCurrentUser(updated);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
    db.get('users').get(currentUser.id).put({ [key]: value });
  };

  const handleBanUser = (userId: string, durationMs: number) => {
    if (!activeChat) return;
    const expiry = Date.now() + durationMs;
    const updatedBanned = { ...(activeChat.bannedUsers || {}), [userId]: expiry };
    db.get('chats').get(activeChat.id).put({
      bannedUsers: JSON.stringify(updatedBanned)
    });
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || !currentUser || !activeChat) return;
    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: inputText,
      timestamp: new Date()
    };
    const updatedMessages = [...activeChat.messages, newMessage];
    db.get('chats').get(activeChat.id).put({
      messages: JSON.stringify(updatedMessages),
      lastMessage: inputText
    });
    setInputText('');
  }, [inputText, activeChat, currentUser]);

  const handleCreateChat = () => {
    if (!newName.trim() || !currentUser || !showCreateModal) return;
    const cid = Math.random().toString(36).substr(2, 9);
    const newChat: Chat = {
      id: cid,
      name: newName.trim(),
      handle: newHandle ? `@${newHandle.replace('@', '')}` : undefined,
      type: showCreateModal,
      participants: [currentUser.id],
      bannedUsers: {},
      messages: [],
      creatorId: currentUser.id
    };
    db.get('chats').get(cid).put({
      ...newChat,
      participants: JSON.stringify(newChat.participants),
      bannedUsers: JSON.stringify(newChat.bannedUsers),
      messages: JSON.stringify(newChat.messages)
    }, (ack: any) => {
      if (!ack.err) {
        db.get('chat_directory').get(cid).put(cid);
      }
    });
    setActiveChatId(cid);
    setShowCreateModal(null);
    setNewName('');
    setNewHandle('');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setActiveView(FluxurView.AUTH);
  };

  const currentThemeClass = THEMES[currentUser?.theme || 'dark'];
  const currentNavTheme = NAV_THEMES[currentUser?.theme || 'dark'];

  if (activeView === FluxurView.AUTH) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-slate-950 p-6 text-white font-inter">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl relative animate-in zoom-in-95 duration-500">
          <div className="flex flex-col items-center mb-10 text-center">
            <ICONS.Logo className="w-24 h-24 mb-4 drop-shadow-[0_0_20px_rgba(34,211,238,0.6)]" />
            <h1 className="text-5xl font-outfit font-black tracking-tighter">{t('appName')}</h1>
            <p className="text-slate-400 text-sm mt-3">{t('tagline')}</p>
          </div>
          <div className="space-y-4">
            {authMode === 'register' && (
              <div className="flex flex-col items-center mb-6">
                <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarSelect} />
                <div onClick={() => avatarInputRef.current?.click()} className="w-28 h-28 rounded-3xl border-4 border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-indigo-500 transition-all shadow-2xl group">
                  <img src={authForm.avatar} className="w-full h-full object-cover group-hover:scale-110 transition-transform" alt="Avatar" />
                </div>
              </div>
            )}
            {authMode === 'register' && (
              <input type="text" placeholder={t('auth_name')} className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} />
            )}
            <input type="text" placeholder={t('auth_login')} className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.login} onChange={e => setAuthForm({...authForm, login: e.target.value})} />
            <input type="password" placeholder={t('auth_pass')} className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} />
            {authError && <p className="text-red-400 text-xs text-center font-bold animate-pulse">{authError}</p>}
            <button onClick={handleAuth} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-5 rounded-3xl transition-all shadow-xl active:scale-95 text-xs uppercase tracking-[0.2em]">
              {authMode === 'login' ? t('auth_btn_login') : t('auth_btn_register')}
            </button>
            <p className="text-slate-500 text-[10px] text-center cursor-pointer hover:text-indigo-400 mt-8 font-bold uppercase tracking-widest" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>
              {authMode === 'login' ? t('auth_switch_to_reg') : t('auth_switch_to_login')}
            </p>
          </div>
          {isSyncing && (
            <div className="absolute -bottom-16 left-0 right-0 flex justify-center items-center gap-3 opacity-60">
              <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-ping" />
              <span className="text-[10px] uppercase tracking-[0.4em] font-black animate-pulse">Network Syncing...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-all duration-700 ${currentThemeClass}`}>
      <nav className={`w-24 border-r flex flex-col items-center py-10 gap-10 shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
        <div className="w-14 h-14 cursor-pointer hover:scale-110 mb-6 transition-all" onClick={() => setActiveView(FluxurView.CHATS)}><ICONS.Logo className="drop-shadow-lg" /></div>
        <button onClick={() => setActiveView(FluxurView.CHATS)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.CHATS ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Message /></button>
        <button onClick={() => setActiveView(FluxurView.PROFILE)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.PROFILE ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.User /></button>
        {currentUser?.role === 'developer' && (
          <button onClick={() => setActiveView(FluxurView.ADMIN)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.ADMIN ? 'bg-amber-500 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Sparkles /></button>
        )}
        <div className="flex-1" />
        <button onClick={() => setActiveView(FluxurView.SETTINGS)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.SETTINGS ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Settings /></button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activeView === FluxurView.CHATS ? (
          <>
            <aside className={`w-full md:w-96 border-r flex flex-col shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
              <div className="p-8 flex flex-col h-full">
                <div className="flex items-center justify-between mb-10">
                  <h2 className="text-3xl font-black font-outfit tracking-tighter">{t('appName')}</h2>
                  <div className="flex gap-3">
                    <button onClick={() => setShowCreateModal('group')} className="p-3 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded-2xl transition-all"><ICONS.Plus className="w-5 h-5" /></button>
                    <button onClick={() => setShowCreateModal('channel')} className="p-3 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-2xl transition-all"><ICONS.Message className="w-5 h-5" /></button>
                  </div>
                </div>
                <div className="relative mb-8">
                  <ICONS.Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" placeholder={t('chat_search')} className="w-full text-sm py-4 pl-12 pr-6 rounded-2xl bg-slate-800/20 border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium" value={chatSearchQuery} onChange={(e) => setChatSearchQuery(e.target.value)} />
                </div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                  {searchResults.map(chat => (
                    <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`p-5 rounded-[2rem] cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xl scale-[0.97]' : 'hover:bg-indigo-500/5 border-transparent hover:scale-[0.99]'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-black text-sm truncate">{chat.name}</span>
                        {chat.isBlocked && <span className="text-[7px] bg-red-600 text-white px-2 py-0.5 rounded-full font-black uppercase">Blocked</span>}
                      </div>
                      <p className={`text-[11px] truncate ${activeChatId === chat.id ? 'text-indigo-100' : 'text-slate-500'}`}>{chat.lastMessage || t('msg_no_messages')}</p>
                    </div>
                  ))}
                  {searchResults.length === 0 && (
                    <div className="text-center py-24 opacity-20">
                      <ICONS.Logo className="w-16 h-16 mx-auto mb-4 grayscale" />
                      <p className="text-xs font-black uppercase tracking-[0.3em]">{t('chat_empty')}</p>
                    </div>
                  )}
                </div>
              </div>
            </aside>
            <main className={`flex-1 flex-col ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
              {activeChat ? (
                <>
                  <header className="h-24 border-b border-slate-800 px-10 flex items-center justify-between backdrop-blur-3xl bg-slate-900/10">
                    <div className="flex items-center gap-5">
                      <button onClick={() => setActiveChatId(null)} className="md:hidden p-3 hover:bg-slate-800 rounded-full"><ICONS.Back /></button>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-600/20 rounded-2xl flex items-center justify-center font-black text-indigo-400">
                          {activeChat.name[0]}
                        </div>
                        <div>
                          <h3 className="font-black text-xl font-outfit leading-tight">{activeChat.name}</h3>
                          <p className="text-[10px] text-indigo-500 font-black uppercase tracking-[0.2em] mt-1">{activeChat.handle || activeChat.type}</p>
                        </div>
                      </div>
                    </div>
                    {(currentUser?.id === activeChat.creatorId || currentUser?.role === 'developer') && (
                      <button onClick={() => setShowModModal(true)} className="px-6 py-3 bg-slate-800 hover:bg-indigo-600 text-white rounded-[1.2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl active:scale-90">
                        {t('mod_title')}
                      </button>
                    )}
                  </header>
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-10 space-y-8">
                    {activeChat.isBlocked && currentUser?.role !== 'developer' ? (
                      <div className="flex flex-col items-center justify-center h-full text-red-500 gap-6 opacity-40 select-none">
                        <ICONS.Logo className="w-24 h-24 grayscale animate-pulse" />
                        <span className="font-black uppercase tracking-[0.6em] text-lg">{t('chat_blocked')}</span>
                      </div>
                    ) : (
                      activeChat.messages.map(m => (
                        <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-3`}>
                          <div className={`max-w-[80%] md:max-w-[70%] p-5 rounded-[2rem] shadow-2xl relative ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800/80 text-slate-100 border border-slate-700 rounded-tl-none'}`}>
                            <p className="text-[10px] font-black opacity-30 mb-2 uppercase tracking-widest">{m.senderName}</p>
                            <p className="text-sm md:text-base leading-relaxed font-medium">{m.text}</p>
                            <p className={`text-[8px] font-black opacity-20 mt-3 text-right`}>{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {!activeChat.isBlocked && (
                    <footer className="p-10 pt-0">
                      <div className="border border-slate-800 rounded-[2.5rem] p-3 flex items-center gap-3 bg-slate-900/60 shadow-inner backdrop-blur-2xl">
                        <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder={t('chat_input_placeholder')} className="flex-1 bg-transparent border-none outline-none px-6 py-4 text-sm font-semibold" />
                        <button onClick={handleSendMessage} className="p-5 bg-indigo-600 text-white rounded-[1.5rem] shadow-2xl hover:bg-indigo-500 hover:rotate-12 transition-all active:scale-75"><ICONS.Send className="w-6 h-6" /></button>
                      </div>
                    </footer>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30 select-none animate-in fade-in duration-1000">
                  <ICONS.Logo className="w-72 h-72 mb-8 grayscale opacity-50 transition-all hover:opacity-100 hover:grayscale-0 hover:scale-105" />
                  <p className="font-outfit font-black text-5xl uppercase tracking-tighter">{t('appName')}</p>
                  <p className="text-sm font-black mt-3 tracking-[0.5em] uppercase text-indigo-500">{t('chat_no_select')}</p>
                </div>
              )}
            </main>
          </>
        ) : activeView === FluxurView.ADMIN ? (
          <div className="flex-1 p-16 max-w-7xl mx-auto overflow-y-auto space-y-16 animate-in slide-in-from-right-10">
            <h1 className="text-7xl font-black font-outfit tracking-tighter uppercase mb-20">{t('admin_title')}</h1>
            <div className="grid lg:grid-cols-2 gap-16">
              <section className="space-y-8">
                <h3 className="text-sm font-black uppercase tracking-[0.5em] text-indigo-500 flex items-center gap-3">
                   <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                   {t('admin_users')} ({registeredUsers.length})
                </h3>
                <div className="space-y-4">
                  {registeredUsers.map(u => (
                    <div key={u.id} className="p-6 bg-slate-900/40 border border-slate-800 rounded-[2.5rem] flex items-center justify-between hover:border-indigo-500/40 transition-all group">
                      <div className="flex items-center gap-5">
                        <img src={u.avatar} className="w-14 h-14 rounded-2xl object-cover shadow-2xl group-hover:scale-110 transition-transform" />
                        <div>
                          <p className="font-black text-base">{u.name}</p>
                          <p className="text-xs text-slate-500 font-bold">@{u.login}</p>
                        </div>
                      </div>
                      <button onClick={() => { db.get('users').get(u.id).put({ isBlocked: !u.isBlocked }); }} className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all ${u.isBlocked ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                        {u.isBlocked ? t('admin_unblock_user') : t('admin_block_user')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              <section className="space-y-8">
                <h3 className="text-sm font-black uppercase tracking-[0.5em] text-emerald-500 flex items-center gap-3">
                   <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                   {t('admin_chats')} ({chats.length})
                </h3>
                <div className="space-y-4">
                  {chats.map(c => (
                    <div key={c.id} className="p-6 bg-slate-900/40 border border-slate-800 rounded-[2.5rem] flex items-center justify-between hover:border-emerald-500/40 transition-all group">
                      <div className="truncate mr-6">
                        <p className="font-black text-base truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1 opacity-50">{c.type}</p>
                      </div>
                      <button onClick={() => { db.get('chats').get(c.id).put({ isBlocked: !c.isBlocked }); }} className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shrink-0 ${c.isBlocked ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                        {c.isBlocked ? t('admin_unblock_chat') : t('admin_block_chat')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : activeView === FluxurView.SETTINGS ? (
          <div className="flex-1 p-16 max-w-3xl mx-auto space-y-20 overflow-y-auto animate-in slide-in-from-bottom-10">
            <h1 className="text-7xl font-black font-outfit tracking-tighter uppercase">{t('settings_title')}</h1>
            
            <div className="space-y-16">
              <section className="space-y-8">
                <h3 className="text-xs font-black uppercase tracking-[0.5em] text-slate-500">{t('settings_theme')}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
                  {Object.keys(THEMES).map(themeName => (
                    <button key={themeName} onClick={() => updateSetting('theme', themeName)} className={`px-8 py-6 rounded-[2rem] font-black capitalize transition-all border-4 flex items-center justify-center ${currentUser?.theme === themeName ? 'border-indigo-500 bg-indigo-600/10 shadow-2xl scale-105' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}>
                      {themeName}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-8">
                <h3 className="text-xs font-black uppercase tracking-[0.5em] text-slate-500">{t('settings_language')}</h3>
                <div className="flex flex-col gap-6">
                  <div className="flex gap-4">
                    <button onClick={() => updateSetting('language', 'ru')} className={`flex-1 py-5 rounded-[1.5rem] font-black transition-all text-sm uppercase tracking-widest ${currentUser?.language === 'ru' ? 'bg-indigo-600 shadow-2xl scale-105' : 'bg-slate-800 opacity-40 hover:opacity-100'}`}>Русский</button>
                    <button onClick={() => updateSetting('language', 'en')} className={`flex-1 py-5 rounded-[1.5rem] font-black transition-all text-sm uppercase tracking-widest ${currentUser?.language === 'en' ? 'bg-indigo-600 shadow-2xl scale-105' : 'bg-slate-800 opacity-40 hover:opacity-100'}`}>English</button>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">{t('settings_lang_any')}</p>
                    <input type="text" placeholder="Spanish, French, Japanese..." className="w-full bg-slate-900/50 border-2 border-slate-800 rounded-[1.5rem] py-5 px-8 outline-none focus:border-indigo-500 transition-all font-bold text-lg" value={currentUser?.language} onChange={e => updateSetting('language', e.target.value.toLowerCase())} />
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-16 flex items-center justify-center animate-in zoom-in-90 duration-500">
             <div className="bg-slate-900/40 border border-slate-800 p-20 rounded-[5rem] text-center max-w-lg w-full shadow-[0_40px_100px_rgba(0,0,0,0.6)] backdrop-blur-md relative overflow-hidden group">
                <div className="absolute inset-0 bg-indigo-600/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <input type="file" ref={profileAvatarInputRef} className="hidden" accept="image/*" onChange={handleProfileAvatarSelect} />
                <div className="relative inline-block mb-10 cursor-pointer group/avatar" onClick={() => profileAvatarInputRef.current?.click()}>
                  <div className="absolute inset-0 bg-black/40 rounded-[4rem] flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity z-10">
                    <span className="text-white text-[10px] font-black uppercase tracking-widest">Изменить</span>
                  </div>
                  <img src={currentUser?.avatar} className="w-48 h-48 rounded-[4rem] shadow-2xl border-4 border-indigo-600/20 object-cover group-hover:scale-105 transition-transform" />
                  {currentUser?.isPremium && <div className="absolute -top-6 -right-6 bg-amber-500 text-white p-4 rounded-3xl shadow-2xl animate-bounce z-20"><ICONS.Sparkles className="w-8 h-8" /></div>}
                </div>
                <h2 className="text-5xl font-black font-outfit mb-3 tracking-tighter">{currentUser?.name}</h2>
                <p className="text-indigo-500 font-black tracking-[0.3em] text-sm mb-16 uppercase">@{currentUser?.login}</p>
                <button onClick={handleLogout} className="w-full py-6 bg-red-600/10 text-red-500 rounded-[2rem] font-black uppercase tracking-[0.4em] hover:bg-red-600 hover:text-white transition-all shadow-xl active:scale-95 text-xs">
                  {t('profile_logout')}
                </button>
             </div>
          </div>
        )}
      </div>

      {showModModal && activeChat && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-3xl z-50 flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-[4.5rem] p-16 overflow-hidden flex flex-col max-h-[90vh] shadow-[0_50px_150px_rgba(0,0,0,1)] relative">
            <div className="flex justify-between items-center mb-12">
              <h3 className="text-4xl font-black font-outfit uppercase tracking-tighter">{t('mod_title')}</h3>
              <button onClick={() => setShowModModal(false)} className="w-14 h-14 flex items-center justify-center bg-slate-800 rounded-full hover:bg-red-600 transition-all text-3xl font-light">&times;</button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-4 space-y-10 custom-scrollbar">
              <div className="space-y-6">
                <h4 className="text-[11px] font-black uppercase tracking-[0.5em] text-slate-500 ml-2">{t('mod_participants')}</h4>
                {activeChat.participants.map(pId => {
                  const u = registeredUsers.find(ru => ru.id === pId);
                  if (!u || u.id === currentUser?.id) return null;
                  return (
                    <div key={pId} className="flex flex-col sm:flex-row sm:items-center justify-between p-6 bg-slate-800/40 rounded-[2.5rem] border border-slate-800 gap-5 hover:border-indigo-500/30 transition-all">
                      <div className="flex items-center gap-5">
                        <img src={u.avatar} className="w-12 h-12 rounded-2xl object-cover shadow-xl" />
                        <div>
                          <p className="font-black text-sm">{u.name}</p>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">@{u.login}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => handleBanUser(u.id, 86400000)} className="text-[9px] px-4 py-2.5 bg-amber-600/10 text-amber-500 rounded-xl font-black uppercase hover:bg-amber-600 hover:text-white transition-all">{t('mod_ban_1d')}</button>
                        <button onClick={() => handleBanUser(u.id, 604800000)} className="text-[9px] px-4 py-2.5 bg-orange-600/10 text-orange-500 rounded-xl font-black uppercase hover:bg-orange-600 hover:text-white transition-all">{t('mod_ban_1w')}</button>
                        <button onClick={() => handleBanUser(u.id, 31536000000)} className="text-[9px] px-4 py-2.5 bg-red-600/10 text-red-500 rounded-xl font-black uppercase hover:bg-red-600 hover:text-white transition-all">{t('mod_ban_1y')}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-12 pt-10 border-t border-slate-800">
              <button onClick={() => { if(confirm(t('mod_delete_chat') + '?')) { db.get('chats').get(activeChat.id).put(null as any); setActiveChatId(null); setShowModModal(false); } }} className="w-full py-6 bg-red-600/10 text-red-500 rounded-[2.5rem] font-black uppercase tracking-[0.4em] hover:bg-red-600 hover:text-white transition-all shadow-2xl active:scale-95 text-[10px]">
                {t('mod_delete_chat')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-50 flex items-center justify-center p-6 animate-in zoom-in-95 duration-500">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-[4rem] p-12 shadow-[0_40px_100px_rgba(0,0,0,0.8)]">
            <h3 className="text-4xl font-black font-outfit mb-10 uppercase tracking-tighter text-center">{showCreateModal === 'channel' ? t('modal_create_channel') : t('modal_create_chat')}</h3>
            <div className="space-y-6 mb-12">
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Display Name</p>
                <input type="text" placeholder="e.g. Fluxur Hub..." className="w-full bg-slate-800 border-2 border-slate-700 rounded-[1.5rem] py-5 px-8 outline-none focus:border-indigo-500 text-white font-bold text-lg transition-all" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div className="space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-2">Handle (ID)</p>
                <input type="text" placeholder="e.g. news..." className="w-full bg-slate-800 border-2 border-slate-700 rounded-[1.5rem] py-5 px-8 outline-none focus:border-indigo-500 text-white font-bold text-lg transition-all" value={newHandle} onChange={e => setNewHandle(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowCreateModal(null)} className="flex-1 py-5 text-slate-500 font-black uppercase text-[10px] tracking-[0.3em] hover:text-white transition-colors">{t('modal_cancel')}</button>
              <button onClick={handleCreateChat} className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.8rem] font-black uppercase text-[10px] tracking-[0.4em] shadow-2xl hover:bg-indigo-500 active:scale-90 transition-all">{t('modal_create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
