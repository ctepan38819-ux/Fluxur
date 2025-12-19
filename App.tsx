
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView, FileAttachment } from './types';
import { ICONS, COLORS } from './constants';
import { translations } from './translations';
import { chatWithAssistant, summarizeConversation } from './geminiService';

// --- Gun.js Global Instance ---
const gun = (window as any).Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us-west.herokuapp.com/gun',
  'https://gun-eu-west.herokuapp.com/gun',
  'https://fluxur-relay-p2p.herokuapp.com/gun',
  'https://peer.wall.org/gun'
]);
const db = gun.get('fluxur_v5_global');

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
    db.get('users').map().on((data: any) => {
      if (data && data.id) {
        setRegisteredUsers(prev => {
          const filtered = prev.filter(u => u.id !== data.id);
          return [...filtered, data];
        });
        setIsSyncing(false);
      }
    });

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
        } catch (e) { console.error("Parse error", e); }
      } else if (data === null) {
        setChats(prev => prev.filter(c => c.id !== id));
      }
    });

    const savedSession = localStorage.getItem('fluxur_session_v5');
    if (savedSession) {
      setCurrentUser(JSON.parse(savedSession));
      setActiveView(FluxurView.CHATS);
    }
    setTimeout(() => setIsSyncing(false), 3000);
  }, []);

  const langCode = currentUser?.language || 'ru';
  const t = (key: string) => {
    const set = translations[langCode] || translations['en'];
    return set[key] || key;
  };

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  const myChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter(c => {
      if (c.isBlocked && currentUser.role !== 'developer') return false;
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
              setCurrentUser(newUser);
              localStorage.setItem('fluxur_session_v5', JSON.stringify(newUser));
              setActiveView(FluxurView.CHATS);
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
              localStorage.setItem('fluxur_session_v5', JSON.stringify(user));
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
    localStorage.setItem('fluxur_session_v5', JSON.stringify(updated));
    db.get('users').get(currentUser.id).put({ [key]: value });
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

  const adminBlockUser = (uId: string, block: boolean) => {
    db.get('users').get(uId).put({ isBlocked: block });
  };

  const adminBlockChat = (cId: string, block: boolean) => {
    db.get('chats').get(cId).put({ isBlocked: block });
  };

  const handleBanUser = (targetUserId: string, durationMs: number) => {
    if (!activeChat || !currentUser || activeChat.creatorId !== currentUser.id) return;
    const expiry = Date.now() + durationMs;
    const updatedBanned = { ...(activeChat.bannedUsers || {}), [targetUserId]: expiry };
    const updatedParticipants = activeChat.participants.filter(id => id !== targetUserId);
    db.get('chats').get(activeChat.id).put({
      bannedUsers: JSON.stringify(updatedBanned),
      participants: JSON.stringify(updatedParticipants)
    });
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
      <div className="flex items-center justify-center h-screen w-screen bg-slate-950 p-6 text-white overflow-hidden">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95">
          <div className="flex flex-col items-center mb-10 text-center">
            <ICONS.Logo className="w-20 h-20 mb-4" />
            <h1 className="text-4xl font-outfit font-black tracking-tight">{t('appName')}</h1>
            <p className="text-slate-400 text-sm mt-2">{t('tagline')}</p>
          </div>
          <div className="space-y-4">
            {authMode === 'register' && (
              <div className="flex flex-col items-center mb-4">
                <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarSelect} />
                <div onClick={() => avatarInputRef.current?.click()} className="w-24 h-24 rounded-full border-2 border-slate-700 bg-slate-800 flex items-center justify-center overflow-hidden cursor-pointer">
                  <img src={authForm.avatar} className="w-full h-full object-cover" alt="Avatar" />
                </div>
              </div>
            )}
            {authMode === 'register' && (
              <input type="text" placeholder={t('auth_name')} className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3.5 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} />
            )}
            <input type="text" placeholder={t('auth_login')} className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3.5 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.login} onChange={e => setAuthForm({...authForm, login: e.target.value})} />
            <input type="password" placeholder={t('auth_pass')} className="w-full bg-slate-800 border border-slate-700 rounded-xl py-3.5 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} />
            {authError && <p className="text-red-400 text-xs text-center font-bold">{authError}</p>}
            <button onClick={handleAuth} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 rounded-xl transition-all shadow-xl active:scale-95">
              {authMode === 'login' ? t('auth_btn_login') : t('auth_btn_register')}
            </button>
            <p className="text-slate-500 text-xs text-center cursor-pointer hover:text-indigo-400 mt-4" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? t('auth_switch_to_reg') : t('auth_switch_to_login')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-all duration-500 ${currentThemeClass}`}>
      <nav className={`w-20 border-r flex flex-col items-center py-8 gap-8 shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
        <div className="w-12 h-12 cursor-pointer hover:scale-110 mb-4" onClick={() => setActiveView(FluxurView.CHATS)}><ICONS.Logo /></div>
        <button onClick={() => setActiveView(FluxurView.CHATS)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.CHATS ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100'}`}><ICONS.Message /></button>
        <button onClick={() => setActiveView(FluxurView.PROFILE)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.PROFILE ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100'}`}><ICONS.User /></button>
        {currentUser?.role === 'developer' && (
          <button onClick={() => setActiveView(FluxurView.ADMIN)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.ADMIN ? 'bg-amber-500 text-white shadow-lg' : 'opacity-40 hover:opacity-100'}`}><ICONS.Sparkles /></button>
        )}
        <div className="flex-1" />
        <button onClick={() => setActiveView(FluxurView.SETTINGS)} className={`p-3 rounded-2xl transition-all ${activeView === FluxurView.SETTINGS ? 'bg-indigo-600 text-white shadow-lg' : 'opacity-40 hover:opacity-100'}`}><ICONS.Settings /></button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activeView === FluxurView.CHATS ? (
          <>
            <aside className={`w-full md:w-80 border-r flex flex-col shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
              <div className="p-6 flex flex-col h-full">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-black">{t('appName')}</h2>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCreateModal('group')} className="p-2 hover:bg-indigo-500/10 rounded-xl text-indigo-400"><ICONS.Plus className="w-5 h-5" /></button>
                    <button onClick={() => setShowCreateModal('channel')} className="p-2 hover:bg-emerald-500/10 rounded-xl text-emerald-400"><ICONS.Message className="w-5 h-5" /></button>
                  </div>
                </div>
                <div className="relative mb-6">
                  <ICONS.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" placeholder={t('chat_search')} className="w-full text-xs py-3 pl-10 pr-4 rounded-xl bg-slate-800/20 border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" value={chatSearchQuery} onChange={(e) => setChatSearchQuery(e.target.value)} />
                </div>
                <div className="flex-1 overflow-y-auto space-y-2">
                  {searchResults.map(chat => (
                    <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`p-4 rounded-2xl cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl' : 'hover:bg-indigo-500/5 border-transparent'}`}>
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-sm truncate block">{chat.name}</span>
                        {chat.isBlocked && <span className="text-[8px] bg-red-600 px-1 rounded">BLOCKED</span>}
                      </div>
                      <p className={`text-xs truncate mt-1 ${activeChatId === chat.id ? 'text-indigo-100' : 'text-slate-500'}`}>{chat.lastMessage || t('msg_no_messages')}</p>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
            <main className={`flex-1 flex-col ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
              {activeChat ? (
                <>
                  <header className="h-20 border-b border-slate-800 px-8 flex items-center justify-between backdrop-blur-md">
                    <div className="flex items-center gap-4">
                      <button onClick={() => setActiveChatId(null)} className="md:hidden p-2"><ICONS.Back /></button>
                      <h3 className="font-black text-lg">{activeChat.name}</h3>
                    </div>
                    {(currentUser?.id === activeChat.creatorId || currentUser?.role === 'developer') && (
                      <button onClick={() => setShowModModal(true)} className="px-4 py-2 bg-slate-800 hover:bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                        {t('mod_title')}
                      </button>
                    )}
                  </header>
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {activeChat.isBlocked && currentUser?.role !== 'developer' ? (
                      <div className="flex items-center justify-center h-full text-red-500 font-bold uppercase tracking-widest animate-pulse">{t('chat_blocked')}</div>
                    ) : (
                      activeChat.messages.map(m => (
                        <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] p-4 rounded-2xl shadow-xl ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white' : 'bg-slate-800/80 text-slate-100 border border-slate-700'}`}>
                            <p className="text-[10px] font-black opacity-50 mb-1">{m.senderName}</p>
                            <p className="text-sm">{m.text}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {!activeChat.isBlocked && (
                    <footer className="p-6">
                      <div className="border border-slate-800 rounded-2xl p-2 flex items-center gap-2 bg-slate-900/50 shadow-2xl">
                        <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder={t('chat_input_placeholder')} className="flex-1 bg-transparent border-none outline-none px-4 py-3 text-sm" />
                        <button onClick={handleSendMessage} className="p-4 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-105 active:scale-95 transition-all"><ICONS.Send className="w-5 h-5" /></button>
                      </div>
                    </footer>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30">
                  <ICONS.Logo className="w-48 h-48 mb-6 grayscale" />
                  <p className="font-outfit font-black text-2xl uppercase tracking-widest">{t('appName')}</p>
                </div>
              )}
            </main>
          </>
        ) : activeView === FluxurView.ADMIN ? (
          <div className="flex-1 p-12 max-w-6xl mx-auto overflow-y-auto space-y-12">
            <h1 className="text-5xl font-black tracking-tighter">{t('admin_title')}</h1>
            <div className="grid md:grid-cols-2 gap-12">
              <section className="space-y-6">
                <h3 className="text-xl font-bold uppercase tracking-widest text-indigo-400">{t('admin_users')}</h3>
                <div className="space-y-3">
                  {registeredUsers.map(u => (
                    <div key={u.id} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <img src={u.avatar} className="w-10 h-10 rounded-full" />
                        <div><p className="font-bold text-sm">{u.name}</p><p className="text-xs text-slate-500">@{u.login}</p></div>
                      </div>
                      <button onClick={() => adminBlockUser(u.id, !u.isBlocked)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase ${u.isBlocked ? 'bg-emerald-600' : 'bg-red-600'}`}>
                        {u.isBlocked ? t('admin_unblock_user') : t('admin_block_user')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
              <section className="space-y-6">
                <h3 className="text-xl font-bold uppercase tracking-widest text-emerald-400">{t('admin_chats')}</h3>
                <div className="space-y-3">
                  {chats.map(c => (
                    <div key={c.id} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                      <div className="truncate mr-4"><p className="font-bold text-sm truncate">{c.name}</p><p className="text-xs text-slate-500">{c.type}</p></div>
                      <button onClick={() => adminBlockChat(c.id, !c.isBlocked)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase shrink-0 ${c.isBlocked ? 'bg-emerald-600' : 'bg-red-600'}`}>
                        {c.isBlocked ? t('admin_unblock_chat') : t('admin_block_chat')}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : activeView === FluxurView.SETTINGS ? (
          <div className="flex-1 p-12 max-w-2xl mx-auto space-y-12 overflow-y-auto">
            <h1 className="text-5xl font-black tracking-tighter">{t('settings_title')}</h1>
            
            <div className="space-y-8">
              <section className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">{t('settings_theme')}</h3>
                <div className="flex flex-wrap gap-3">
                  {Object.keys(THEMES).map(themeName => (
                    <button key={themeName} onClick={() => updateSetting('theme', themeName)} className={`px-6 py-3 rounded-2xl font-bold capitalize transition-all border-2 ${currentUser?.theme === themeName ? 'border-indigo-500 bg-indigo-600/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600'}`}>
                      {themeName}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">{t('settings_language')}</h3>
                <div className="flex gap-4">
                  <button onClick={() => updateSetting('language', 'ru')} className={`px-8 py-4 rounded-2xl font-black ${currentUser?.language === 'ru' ? 'bg-indigo-600' : 'bg-slate-800'}`}>RU</button>
                  <button onClick={() => updateSetting('language', 'en')} className={`px-8 py-4 rounded-2xl font-black ${currentUser?.language === 'en' ? 'bg-indigo-600' : 'bg-slate-800'}`}>EN</button>
                  <input type="text" placeholder={t('settings_lang_any')} className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl px-6 outline-none focus:ring-2 focus:ring-indigo-500" value={currentUser?.language} onChange={e => updateSetting('language', e.target.value.toLowerCase())} />
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-12 flex items-center justify-center">
             <div className="bg-slate-900 border border-slate-800 p-12 rounded-[4rem] text-center max-w-md w-full shadow-2xl">
                <img src={currentUser?.avatar} className="w-32 h-32 rounded-[2rem] mx-auto mb-6 shadow-2xl border-4 border-indigo-600/20" />
                <h2 className="text-4xl font-black mb-2">{currentUser?.name}</h2>
                <p className="text-indigo-400 font-bold tracking-widest mb-12">@{currentUser?.login}</p>
                <button onClick={() => { setCurrentUser(null); localStorage.removeItem('fluxur_session_v5'); setActiveView(FluxurView.AUTH); }} className="w-full py-5 bg-red-600/10 text-red-500 rounded-3xl font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all">
                  {t('profile_logout')}
                </button>
             </div>
          </div>
        )}
      </div>

      {showModModal && activeChat && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-[3rem] p-10 overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-3xl font-black">{t('mod_title')}</h3>
              <button onClick={() => setShowModModal(false)} className="text-2xl">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto pr-2 space-y-6">
              <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">{t('mod_participants')}</h4>
              {activeChat.participants.map(pId => {
                const u = registeredUsers.find(ru => ru.id === pId);
                if (!u || u.id === currentUser?.id) return null;
                return (
                  <div key={pId} className="flex items-center justify-between p-4 bg-slate-800/40 rounded-3xl border border-slate-800">
                    <span className="font-bold text-sm">{u.name}</span>
                    <div className="flex gap-1.5">
                      <button onClick={() => handleBanUser(u.id, 86400000)} className="text-[8px] px-2 py-1.5 bg-amber-600/20 text-amber-500 rounded-lg font-black uppercase">{t('mod_ban_1d')}</button>
                      <button onClick={() => handleBanUser(u.id, 604800000)} className="text-[8px] px-2 py-1.5 bg-orange-600/20 text-orange-500 rounded-lg font-black uppercase">{t('mod_ban_1w')}</button>
                      <button onClick={() => handleBanUser(u.id, 31536000000)} className="text-[8px] px-2 py-1.5 bg-red-600/20 text-red-500 rounded-lg font-black uppercase">{t('mod_ban_1y')}</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={() => { db.get('chats').get(activeChat.id).put(null as any); setActiveChatId(null); setShowModModal(false); }} className="mt-8 p-5 bg-red-600/10 text-red-500 rounded-3xl font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all">
              {t('mod_delete_chat')}
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in zoom-in-95">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-[3rem] p-10">
            <h3 className="text-2xl font-black mb-8">{showCreateModal === 'channel' ? t('modal_create_channel') : t('modal_create_chat')}</h3>
            <div className="space-y-4 mb-10">
              <input type="text" placeholder="Name..." className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-5 outline-none focus:ring-2 focus:ring-indigo-500 text-white" value={newName} onChange={e => setNewName(e.target.value)} />
              <input type="text" placeholder="Handle (e.g. news)..." className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-5 outline-none focus:ring-2 focus:ring-indigo-500 text-white" value={newHandle} onChange={e => setNewHandle(e.target.value)} />
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowCreateModal(null)} className="flex-1 py-4 text-slate-500 font-bold uppercase text-xs">{t('modal_cancel')}</button>
              <button onClick={handleCreateChat} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg">{t('modal_create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
