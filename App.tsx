
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView, FileAttachment } from './types';
import { ICONS, COLORS } from './constants';
import { translations } from './translations';
import { chatWithAssistant, summarizeConversation } from './geminiService';

// --- Gun.js Global Instance ---
// Increased peer list for better global synchronization
const gun = (window as any).Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us-west.herokuapp.com/gun',
  'https://gun-eu-west.herokuapp.com/gun',
  'https://fluxur-relay-p2p.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://dletta.herokuapp.com/gun'
]);
const db = gun.get('fluxur_v6_distributed');

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
  const [activeView, setActiveView] = useState<FluxurView>(FluxurView.AUTH);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isSyncing, setIsSyncing] = useState(true);
  const [showModModal, setShowModModal] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [newHandle, setNewHandle] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState<'group' | 'channel' | null>(null);
  const [newName, setNewName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', login: '', password: '', avatar: DEFAULT_AVATAR });
  const [authError, setAuthError] = useState('');

  // --- Global Synchronization ---
  useEffect(() => {
    // Listen for all users in the network
    db.get('users').map().on((data: any) => {
      if (data && data.id) {
        setRegisteredUsers(prev => {
          const filtered = prev.filter(u => u.id !== data.id);
          return [...filtered, data];
        });
        setIsSyncing(false);
      }
    });

    // Listen for all chats in the network
    db.get('chats').map().on((data: any, id: string) => {
      if (data && data.id) {
        try {
          const parsedChat: Chat = {
            ...data,
            participants: JSON.parse(data.participants || '[]'),
            bannedUsers: JSON.parse(data.bannedUsers || '{}'),
            messages: JSON.parse(data.messages || '[]')
          };
          setChats(prev => {
            const filtered = prev.filter(c => c.id !== parsedChat.id);
            return [...filtered, parsedChat];
          });
        } catch (e) { console.error("Sync parse error", e); }
      } else if (data === null) {
        setChats(prev => prev.filter(c => c.id !== id));
        if (activeChatId === id) setActiveChatId(null);
      }
    });

    // Auto-login from local storage
    const savedSession = localStorage.getItem('fluxur_session_v6');
    if (savedSession) {
      const parsed = JSON.parse(savedSession);
      // Fetch fresh data from network for the session user
      db.get('users').get(parsed.id).once((fresh: any) => {
        if (fresh && fresh.id) {
          setCurrentUser(fresh);
          setActiveView(FluxurView.CHATS);
        } else {
          setCurrentUser(parsed);
          setActiveView(FluxurView.CHATS);
        }
      });
    }
    
    // Safety timeout for syncing state
    const timer = setTimeout(() => setIsSyncing(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  const langCode = currentUser?.language || 'ru';
  const t = (key: string) => {
    const set = translations[langCode] || translations['en'] || translations['ru'];
    return set[key] || key;
  };

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  // Chats visible to user: not globally blocked (unless dev) and user is not banned by creator
  const myChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter(c => {
      const isDev = currentUser.role === 'developer';
      if (c.isBlocked && !isDev) return false;
      
      const isParticipant = c.participants.includes(currentUser.id);
      const banExpiry = c.bannedUsers?.[currentUser.id] || 0;
      const isCurrentlyBanned = banExpiry > Date.now();
      
      return isParticipant && !isCurrentlyBanned;
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

  const handleAuth = async () => {
    setAuthError('');
    const normalizedLogin = authForm.login.trim().toLowerCase();
    
    if (authMode === 'register') {
      if (!authForm.login || !authForm.password || !authForm.name) {
        setAuthError(t('auth_err_fields'));
        return;
      }

      // Check global aliases node for existing login
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
          
          // Put to global users and create alias
          db.get('users').get(newUser.id).put(newUser, (ack: any) => {
            if (ack.err) {
              setAuthError("Sync Error: " + ack.err);
            } else {
              db.get('aliases').get(normalizedLogin).put(newUser.id);
              setCurrentUser(newUser);
              localStorage.setItem('fluxur_session_v6', JSON.stringify(newUser));
              setActiveView(FluxurView.CHATS);
            }
          });
        }
      });
    } else {
      // Login: find ID by login alias
      db.get('aliases').get(normalizedLogin).once((userId: string) => {
        if (userId) {
          db.get('users').get(userId).once((user: any) => {
            if (user && user.password === authForm.password) {
              if (user.isBlocked && normalizedLogin !== DEVELOPER_LOGIN) {
                setAuthError(t('auth_err_blocked'));
                return;
              }
              setCurrentUser(user);
              localStorage.setItem('fluxur_session_v6', JSON.stringify(user));
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
    localStorage.setItem('fluxur_session_v6', JSON.stringify(updated));
    db.get('users').get(currentUser.id).put({ [key]: value });
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || !currentUser || !activeChat) return;
    
    // Check local ban just in case
    const banTime = activeChat.bannedUsers?.[currentUser.id] || 0;
    if (banTime > Date.now()) {
      alert(t('mod_you_are_banned').replace('{date}', new Date(banTime).toLocaleString()));
      return;
    }

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

  const handleBanUser = (targetUserId: string, durationMs: number) => {
    if (!activeChat || !currentUser || (activeChat.creatorId !== currentUser.id && currentUser.role !== 'developer')) return;
    const expiry = Date.now() + durationMs;
    const updatedBanned = { ...(activeChat.bannedUsers || {}), [targetUserId]: expiry };
    const updatedParticipants = activeChat.participants.filter(id => id !== targetUserId);
    db.get('chats').get(activeChat.id).put({
      bannedUsers: JSON.stringify(updatedBanned),
      participants: JSON.stringify(updatedParticipants)
    });
  };

  const handleDeleteChat = () => {
    if (!activeChat || !currentUser || (activeChat.creatorId !== currentUser.id && currentUser.role !== 'developer')) return;
    if (confirm(t('mod_delete_chat') + "?")) {
      db.get('chats').get(activeChat.id).put(null as any);
      setActiveChatId(null);
      setShowModModal(false);
    }
  };

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
    });
    setActiveChatId(cid);
    setShowCreateModal(null);
    setNewName('');
    setNewHandle('');
  };

  const currentThemeClass = THEMES[currentUser?.theme || 'dark'];
  const currentNavTheme = NAV_THEMES[currentUser?.theme || 'dark'];

  if (activeView === FluxurView.AUTH) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-slate-950 p-6 text-white">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl relative animate-in fade-in zoom-in-95 duration-500">
          <div className="flex flex-col items-center mb-10 text-center">
            <ICONS.Logo className="w-20 h-20 mb-4 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]" />
            <h1 className="text-4xl font-outfit font-black tracking-tighter">{t('appName')}</h1>
            <p className="text-slate-400 text-sm mt-2">{t('tagline')}</p>
          </div>
          <div className="space-y-4">
            {authMode === 'register' && (
              <div className="flex flex-col items-center mb-4">
                <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarSelect} />
                <div onClick={() => avatarInputRef.current?.click()} className="w-24 h-24 rounded-3xl border-2 border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-indigo-500 transition-all">
                  <img src={authForm.avatar} className="w-full h-full object-cover" alt="Avatar" />
                </div>
              </div>
            )}
            {authMode === 'register' && (
              <input type="text" placeholder={t('auth_name')} className="w-full bg-slate-800 border border-slate-700 rounded-xl py-4 px-5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} />
            )}
            <input type="text" placeholder={t('auth_login')} className="w-full bg-slate-800 border border-slate-700 rounded-xl py-4 px-5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.login} onChange={e => setAuthForm({...authForm, login: e.target.value})} />
            <input type="password" placeholder={t('auth_pass')} className="w-full bg-slate-800 border border-slate-700 rounded-xl py-4 px-5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} />
            {authError && <p className="text-red-400 text-xs text-center font-bold animate-pulse">{authError}</p>}
            <button onClick={handleAuth} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4.5 rounded-2xl transition-all shadow-xl active:scale-95 text-sm uppercase tracking-widest">
              {authMode === 'login' ? t('auth_btn_login') : t('auth_btn_register')}
            </button>
            <p className="text-slate-500 text-xs text-center cursor-pointer hover:text-indigo-400 mt-6" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>
              {authMode === 'login' ? t('auth_switch_to_reg') : t('auth_switch_to_login')}
            </p>
          </div>
          {isSyncing && (
            <div className="absolute -bottom-16 left-0 right-0 flex justify-center items-center gap-2 opacity-50">
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-ping" />
              <span className="text-[10px] uppercase tracking-[0.3em] font-black">Syncing Fluxur Network...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-all duration-500 ${currentThemeClass}`}>
      <nav className={`w-20 border-r flex flex-col items-center py-8 gap-8 shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
        <div className="w-12 h-12 cursor-pointer hover:scale-110 mb-4 transition-transform" onClick={() => setActiveView(FluxurView.CHATS)}><ICONS.Logo /></div>
        <button onClick={() => setActiveView(FluxurView.CHATS)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.CHATS ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100 hover:scale-110'}`}><ICONS.Message /></button>
        <button onClick={() => setActiveView(FluxurView.PROFILE)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.PROFILE ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100 hover:scale-110'}`}><ICONS.User /></button>
        {currentUser?.role === 'developer' && (
          <button onClick={() => setActiveView(FluxurView.ADMIN)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.ADMIN ? 'bg-amber-500 text-white shadow-lg' : 'opacity-40 hover:opacity-100 hover:scale-110'}`}><ICONS.Sparkles /></button>
        )}
        <div className="flex-1" />
        <button onClick={() => setActiveView(FluxurView.SETTINGS)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.SETTINGS ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100 hover:scale-110'}`}><ICONS.Settings /></button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activeView === FluxurView.CHATS ? (
          <>
            <aside className={`w-full md:w-80 border-r flex flex-col shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
              <div className="p-6 flex flex-col h-full">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-black font-outfit tracking-tighter">{t('appName')}</h2>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCreateModal('group')} className="p-2 hover:bg-indigo-500/10 rounded-xl text-indigo-400 transition-colors"><ICONS.Plus className="w-5 h-5" /></button>
                    <button onClick={() => setShowCreateModal('channel')} className="p-2 hover:bg-emerald-500/10 rounded-xl text-emerald-400 transition-colors"><ICONS.Message className="w-5 h-5" /></button>
                  </div>
                </div>
                <div className="relative mb-6">
                  <ICONS.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" placeholder={t('chat_search')} className="w-full text-xs py-3.5 pl-10 pr-4 rounded-xl bg-slate-800/20 border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={chatSearchQuery} onChange={(e) => setChatSearchQuery(e.target.value)} />
                </div>
                <div className="flex-1 overflow-y-auto space-y-2">
                  {searchResults.map(chat => (
                    <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`p-4 rounded-[1.5rem] cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl scale-[0.98]' : 'hover:bg-indigo-500/5 border-transparent'}`}>
                      <div className="flex justify-between items-start">
                        <span className="font-black text-sm truncate block">{chat.name}</span>
                        {chat.isBlocked && <span className="text-[7px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black">BLOCKED</span>}
                      </div>
                      <p className={`text-[10px] truncate mt-1 ${activeChatId === chat.id ? 'text-indigo-100' : 'text-slate-500'}`}>{chat.lastMessage || t('msg_no_messages')}</p>
                    </div>
                  ))}
                  {searchResults.length === 0 && (
                    <div className="text-center py-20 opacity-20">
                      <ICONS.Logo className="w-12 h-12 mx-auto mb-2 grayscale" />
                      <p className="text-[10px] font-black uppercase tracking-widest">{t('chat_empty')}</p>
                    </div>
                  )}
                </div>
              </div>
            </aside>
            <main className={`flex-1 flex-col ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
              {activeChat ? (
                <>
                  <header className="h-20 border-b border-slate-800 px-8 flex items-center justify-between backdrop-blur-xl bg-slate-900/10">
                    <div className="flex items-center gap-4">
                      <button onClick={() => setActiveChatId(null)} className="md:hidden p-2"><ICONS.Back /></button>
                      <div>
                        <h3 className="font-black text-lg font-outfit">{activeChat.name}</h3>
                        <p className="text-[9px] text-indigo-400 font-black uppercase tracking-widest">{activeChat.handle || activeChat.type}</p>
                      </div>
                    </div>
                    {(currentUser?.id === activeChat.creatorId || currentUser?.role === 'developer') && (
                      <button onClick={() => setShowModModal(true)} className="px-5 py-2.5 bg-slate-800 hover:bg-indigo-600 text-white rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] transition-all shadow-lg">
                        {t('mod_title')}
                      </button>
                    )}
                  </header>
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {activeChat.isBlocked && currentUser?.role !== 'developer' ? (
                      <div className="flex flex-col items-center justify-center h-full text-red-500 gap-4 opacity-50">
                        <ICONS.Logo className="w-20 h-20 grayscale" />
                        <span className="font-black uppercase tracking-[0.5em] text-sm">{t('chat_blocked')}</span>
                      </div>
                    ) : (
                      activeChat.messages.map(m => (
                        <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                          <div className={`max-w-[75%] p-4 rounded-3xl shadow-xl ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800/80 text-slate-100 border border-slate-700 rounded-tl-none'}`}>
                            <p className="text-[9px] font-black opacity-40 mb-1 uppercase tracking-widest">{m.senderName}</p>
                            <p className="text-sm leading-relaxed">{m.text}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {!activeChat.isBlocked && (
                    <footer className="p-6">
                      <div className="border border-slate-800 rounded-3xl p-2.5 flex items-center gap-2 bg-slate-900/40 shadow-2xl backdrop-blur-md">
                        <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder={t('chat_input_placeholder')} className="flex-1 bg-transparent border-none outline-none px-5 py-3 text-sm" />
                        <button onClick={handleSendMessage} className="p-4 bg-indigo-600 text-white rounded-2xl shadow-lg hover:bg-indigo-500 transition-all active:scale-90"><ICONS.Send className="w-5 h-5" /></button>
                      </div>
                    </footer>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30 select-none">
                  <ICONS.Logo className="w-64 h-64 mb-6 grayscale animate-pulse" />
                  <p className="font-outfit font-black text-4xl uppercase tracking-tighter">{t('appName')}</p>
                  <p className="text-xs font-black mt-2 tracking-[0.4em] uppercase">{t('chat_no_select')}</p>
                </div>
              )}
            </main>
          </>
        ) : activeView === FluxurView.ADMIN ? (
          <div className="flex-1 p-12 max-w-6xl mx-auto overflow-y-auto space-y-12">
            <h1 className="text-6xl font-black font-outfit tracking-tighter uppercase">{t('admin_title')}</h1>
            <div className="grid md:grid-cols-2 gap-12">
              <section className="space-y-6">
                <h3 className="text-xs font-black uppercase tracking-[0.4em] text-indigo-400">{t('admin_users')} ({registeredUsers.length})</h3>
                <div className="space-y-3">
                  {registeredUsers.map(u => (
                    <div key={u.id} className="p-5 bg-slate-900/50 border border-slate-800 rounded-[2rem] flex items-center justify-between hover:border-indigo-500/30 transition-all">
                      <div className="flex items-center gap-4">
                        <img src={u.avatar} className="w-12 h-12 rounded-2xl object-cover" />
                        <div>
                          <p className="font-black text-sm">{u.name}</p>
                          <p className="text-[10px] text-slate-500">@{u.login}</p>
                        </div>
                      </div>
                      <button onClick={() => { db.get('users').get(u.id).put({ isBlocked: !u.isBlocked }); }} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${u.isBlocked ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                        {u.isBlocked ? t('admin_unblock_user') : t('admin_block_user')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              <section className="space-y-6">
                <h3 className="text-xs font-black uppercase tracking-[0.4em] text-emerald-400">{t('admin_chats')} ({chats.length})</h3>
                <div className="space-y-3">
                  {chats.map(c => (
                    <div key={c.id} className="p-5 bg-slate-900/50 border border-slate-800 rounded-[2rem] flex items-center justify-between hover:border-emerald-500/30 transition-all">
                      <div className="truncate mr-4">
                        <p className="font-black text-sm truncate">{c.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{c.type}</p>
                      </div>
                      <button onClick={() => { db.get('chats').get(c.id).put({ isBlocked: !c.isBlocked }); }} className={`px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all shrink-0 ${c.isBlocked ? 'bg-emerald-600/20 text-emerald-400' : 'bg-red-600/20 text-red-400'}`}>
                        {c.isBlocked ? t('admin_unblock_chat') : t('admin_block_chat')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : activeView === FluxurView.SETTINGS ? (
          <div className="flex-1 p-12 max-w-2xl mx-auto space-y-16 overflow-y-auto">
            <h1 className="text-6xl font-black font-outfit tracking-tighter uppercase">{t('settings_title')}</h1>
            
            <div className="space-y-12">
              <section className="space-y-6">
                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">{t('settings_theme')}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {Object.keys(THEMES).map(themeName => (
                    <button key={themeName} onClick={() => updateSetting('theme', themeName)} className={`px-6 py-4 rounded-[1.5rem] font-black capitalize transition-all border-2 flex items-center justify-center ${currentUser?.theme === themeName ? 'border-indigo-500 bg-indigo-600/10 shadow-lg' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}>
                      {themeName}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-6">
                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">{t('settings_language')}</h3>
                <div className="flex flex-col gap-4">
                  <div className="flex gap-4">
                    <button onClick={() => updateSetting('language', 'ru')} className={`flex-1 py-4 rounded-2xl font-black transition-all ${currentUser?.language === 'ru' ? 'bg-indigo-600 shadow-xl' : 'bg-slate-800 opacity-50'}`}>RU</button>
                    <button onClick={() => updateSetting('language', 'en')} className={`flex-1 py-4 rounded-2xl font-black transition-all ${currentUser?.language === 'en' ? 'bg-indigo-600 shadow-xl' : 'bg-slate-800 opacity-50'}`}>EN</button>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">{t('settings_lang_any')}</p>
                    <input type="text" placeholder="e.g. French, Japanese..." className="w-full bg-slate-900 border-2 border-slate-800 rounded-2xl py-4 px-6 outline-none focus:border-indigo-500 transition-all font-bold" value={currentUser?.language} onChange={e => updateSetting('language', e.target.value.toLowerCase())} />
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-12 flex items-center justify-center">
             <div className="bg-slate-900/50 border border-slate-800 p-16 rounded-[4rem] text-center max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-sm animate-in zoom-in-95">
                <div className="relative inline-block mb-8">
                  <img src={currentUser?.avatar} className="w-40 h-40 rounded-[3.5rem] shadow-2xl border-4 border-indigo-500/20 object-cover" />
                  {currentUser?.isPremium && <div className="absolute -top-4 -right-4 bg-amber-500 text-white p-3 rounded-2xl shadow-xl animate-bounce"><ICONS.Sparkles className="w-6 h-6" /></div>}
                </div>
                <h2 className="text-4xl font-black font-outfit mb-2">{currentUser?.name}</h2>
                <p className="text-indigo-400 font-black tracking-[0.2em] text-sm mb-12 uppercase">@{currentUser?.login}</p>
                <button onClick={() => { setCurrentUser(null); localStorage.removeItem('fluxur_session_v6'); setActiveView(FluxurView.AUTH); }} className="w-full py-5 bg-red-600/10 text-red-500 rounded-3xl font-black uppercase tracking-[0.3em] hover:bg-red-600 hover:text-white transition-all shadow-xl active:scale-95 text-xs">
                  {t('profile_logout')}
                </button>
             </div>
          </div>
        )}
      </div>

      {showModModal && activeChat && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-[3.5rem] p-12 overflow-hidden flex flex-col max-h-[85vh] shadow-[0_30px_100px_rgba(0,0,0,1)]">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-3xl font-black font-outfit uppercase tracking-tighter">{t('mod_title')}</h3>
              <button onClick={() => setShowModModal(false)} className="w-12 h-12 flex items-center justify-center bg-slate-800 rounded-full hover:bg-red-600 transition-all text-2xl">&times;</button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-3 space-y-8">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500 ml-1">{t('mod_participants')}</h4>
                {activeChat.participants.map(pId => {
                  const u = registeredUsers.find(ru => ru.id === pId);
                  if (!u || u.id === currentUser?.id) return null;
                  return (
                    <div key={pId} className="flex flex-col md:flex-row md:items-center justify-between p-5 bg-slate-800/40 rounded-[2rem] border border-slate-800 gap-4">
                      <div className="flex items-center gap-4">
                        <img src={u.avatar} className="w-10 h-10 rounded-xl" />
                        <div><p className="font-black text-sm">{u.name}</p><p className="text-[9px] text-slate-500">@{u.login}</p></div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => handleBanUser(u.id, 86400000)} className="text-[8px] px-3 py-2 bg-amber-600/20 text-amber-500 rounded-xl font-black uppercase tracking-tighter hover:bg-amber-600 hover:text-white transition-all">{t('mod_ban_1d')}</button>
                        <button onClick={() => handleBanUser(u.id, 604800000)} className="text-[8px] px-3 py-2 bg-orange-600/20 text-orange-500 rounded-xl font-black uppercase tracking-tighter hover:bg-orange-600 hover:text-white transition-all">{t('mod_ban_1w')}</button>
                        <button onClick={() => handleBanUser(u.id, 31536000000)} className="text-[8px] px-3 py-2 bg-red-600/20 text-red-500 rounded-xl font-black uppercase tracking-tighter hover:bg-red-600 hover:text-white transition-all">{t('mod_ban_1y')}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-10 pt-8 border-t border-slate-800">
              <button onClick={handleDeleteChat} className="w-full py-5 bg-red-600/10 text-red-500 rounded-3xl font-black uppercase tracking-[0.3em] hover:bg-red-600 hover:text-white transition-all shadow-xl active:scale-95 text-xs">
                {t('mod_delete_chat')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-lg z-50 flex items-center justify-center p-6 animate-in zoom-in-95 duration-300">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl">
            <h3 className="text-3xl font-black font-outfit mb-8 uppercase tracking-tighter">{showCreateModal === 'channel' ? t('modal_create_channel') : t('modal_create_chat')}</h3>
            <div className="space-y-5 mb-10">
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">Display Name</p>
                <input type="text" placeholder="News Central..." className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 text-white font-bold" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 ml-1">Handle (ID)</p>
                <input type="text" placeholder="news..." className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 text-white font-bold" value={newHandle} onChange={e => setNewHandle(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowCreateModal(null)} className="flex-1 py-4 text-slate-500 font-bold uppercase text-[10px] tracking-widest hover:text-white transition-colors">{t('modal_cancel')}</button>
              <button onClick={handleCreateChat} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] shadow-xl hover:bg-indigo-500 active:scale-95 transition-all">{t('modal_create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
