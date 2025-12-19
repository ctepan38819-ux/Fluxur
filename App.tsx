
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView, FileAttachment } from './types';
import { ICONS, COLORS } from './constants';
import { translations } from './translations';
import { chatWithAssistant, summarizeConversation } from './geminiService';

// --- Конфигурация Gun.js с максимальной избыточностью ---
const RELAYS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us-west.herokuapp.com/gun',
  'https://gun-eu-west.herokuapp.com/gun',
  'https://fluxur-relay-p2p.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://dletta.herokuapp.com/gun',
  'https://gun-ams1.marda.io/gun',
  'https://gun-sjc1.marda.io/gun',
  'https://gunjs.herokuapp.com/gun',
  'https://gun-server.ping-pong.workers.dev/gun'
];

const gun = (window as any).Gun({
  peers: RELAYS,
  localStorage: true,
  radisk: true
});

const APP_DB_KEY = 'fluxur_v11_mesh_pro'; // Свежий ключ для стабильной работы новой версии
const SESSION_STORAGE_KEY = 'fluxur_v11_user_session';
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
  const [peerCount, setPeerCount] = useState(0);
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

  // --- Мониторинг P2P сети ---
  useEffect(() => {
    const checkPeers = () => {
      const peers = (gun as any)._?.opt?.peers || {};
      const count = Object.keys(peers).filter(k => peers[k].wire?.readyState === 1).length;
      setPeerCount(count);
    };
    const interval = setInterval(checkPeers, 2000);
    return () => clearInterval(interval);
  }, []);

  // --- Глобальная синхронизация (Mesh discovery) ---
  useEffect(() => {
    // 1. Синхронизация пользователей
    const usersMap = db.get('discovery').get('users').map();
    usersMap.on((userId) => {
      if (userId && typeof userId === 'string') {
        db.get('users').get(userId).on((userData: any) => {
          if (userData && userData.id) {
            setRegisteredUsers(prev => {
              const others = prev.filter(u => u.id !== userData.id);
              return [...others, { ...userData }];
            });
            // Фоновое обновление профиля, если данные изменились на другом девайсе
            if (currentUser && userData.id === currentUser.id) {
              const updated = { ...userData };
              setCurrentUser(updated);
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
            }
          }
        });
      }
    });

    // 2. Синхронизация чатов
    const chatsMap = db.get('discovery').get('chats').map();
    chatsMap.on((chatId) => {
      if (chatId && typeof chatId === 'string') {
        db.get('chats').get(chatId).on((chatData: any) => {
          if (chatData && chatData.id) {
            try {
              const parsed: Chat = {
                ...chatData,
                participants: JSON.parse(chatData.participants || '[]'),
                bannedUsers: JSON.parse(chatData.bannedUsers || '{}'),
                messages: JSON.parse(chatData.messages || '[]')
              };
              setChats(prev => {
                const others = prev.filter(c => c.id !== parsed.id);
                return [...others, parsed];
              });
              setIsSyncing(false);
            } catch (e) { console.error("Mesh decoding error", e); }
          }
        });
      }
    });

    return () => {
      usersMap.off();
      chatsMap.off();
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chats, activeChatId]);

  const langCode = currentUser?.language || 'ru';
  const t = (key: string) => {
    const set = translations[langCode] || translations['en'] || translations['ru'];
    return set[key] || key;
  };

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  const visibleChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter(c => {
      const isParticipant = c.participants.includes(currentUser.id);
      const isPublic = c.type === 'channel';
      return isParticipant || isPublic;
    });
  }, [chats, currentUser]);

  const searchResults = useMemo(() => {
    const q = chatSearchQuery.toLowerCase().trim();
    if (!q) return visibleChats;
    return chats.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.handle && c.handle.toLowerCase().includes(q))
    );
  }, [visibleChats, chats, chatSearchQuery]);

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
    const login = authForm.login.trim().toLowerCase();
    
    if (authMode === 'register') {
      if (!authForm.login || !authForm.password || !authForm.name) {
        setAuthError(t('auth_err_fields'));
        return;
      }

      db.get('aliases').get(login).once((id) => {
        if (id) {
          setAuthError(t('auth_err_taken'));
        } else {
          const isDev = login === DEVELOPER_LOGIN;
          const uid = Math.random().toString(36).substr(2, 9);
          const newUser: User = {
            id: uid,
            name: authForm.name,
            login: login,
            password: authForm.password,
            avatar: authForm.avatar || DEFAULT_AVATAR,
            status: 'online',
            isPremium: isDev,
            role: isDev ? 'developer' : 'user',
            theme: 'dark',
            language: 'ru',
            isBlocked: false
          };
          
          db.get('users').get(uid).put(newUser, (ack: any) => {
            if (!ack.err) {
              db.get('aliases').get(login).put(uid);
              db.get('discovery').get('users').get(uid).put(uid);
              setCurrentUser(newUser);
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newUser));
              setActiveView(FluxurView.CHATS);
            }
          });
        }
      });
    } else {
      db.get('aliases').get(login).once((userId) => {
        if (userId) {
          db.get('users').get(userId).once((user: any) => {
            if (user && user.password === authForm.password) {
              if (user.isBlocked && login !== DEVELOPER_LOGIN) {
                setAuthError(t('auth_err_blocked'));
                return;
              }
              // При входе на новом девайсе - обновляем индекс обнаружения
              db.get('discovery').get('users').get(userId).put(userId);
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
    db.get('users').get(currentUser.id).get(key).put(value);
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || !currentUser || !activeChat) return;
    if (activeChat.type === 'channel' && activeChat.creatorId !== currentUser.id && currentUser.role !== 'developer') return;

    const msg: Message = {
      id: Math.random().toString(36).substr(2, 9) + Date.now(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: inputText,
      timestamp: new Date()
    };
    
    const newHistory = [...activeChat.messages, msg].slice(-100);
    
    db.get('chats').get(activeChat.id).put({
      messages: JSON.stringify(newHistory),
      lastMessage: inputText
    });
    
    setInputText('');
  }, [inputText, activeChat, currentUser]);

  const handleCreateChat = () => {
    if (!newName.trim() || !currentUser || !showCreateModal) return;
    const cid = Math.random().toString(36).substr(2, 9);
    const handle = newHandle ? `@${newHandle.replace('@', '').toLowerCase()}` : undefined;
    
    const newChat: Chat = {
      id: cid,
      name: newName.trim(),
      handle: handle,
      type: showCreateModal,
      participants: [currentUser.id],
      messages: [],
      creatorId: currentUser.id
    };

    db.get('chats').get(cid).put({
      ...newChat,
      participants: JSON.stringify(newChat.participants),
      messages: JSON.stringify(newChat.messages)
    }, (ack: any) => {
      if (!ack.err) {
        db.get('discovery').get('chats').get(cid).put(cid);
        if (handle) db.get('handles').get(handle).put(cid);
      }
    });

    setActiveChatId(cid);
    setShowCreateModal(null);
    setNewName('');
    setNewHandle('');
  };

  const handleJoinChat = (chat: Chat) => {
    if (!currentUser) return;
    if (chat.participants.includes(currentUser.id)) {
      setActiveChatId(chat.id);
      return;
    }
    const updated = [...chat.participants, currentUser.id];
    db.get('chats').get(chat.id).get('participants').put(JSON.stringify(updated));
    setActiveChatId(chat.id);
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
            <input type="text" placeholder={authMode === 'register' ? t('auth_name') : t('auth_login')} className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authMode === 'register' ? authForm.name : authForm.login} onChange={e => authMode === 'register' ? setAuthForm({...authForm, name: e.target.value}) : setAuthForm({...authForm, login: e.target.value})} />
            {authMode === 'register' && <input type="text" placeholder={t('auth_login')} className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.login} onChange={e => setAuthForm({...authForm, login: e.target.value})} />}
            <input type="password" placeholder={t('auth_pass')} className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-4 px-6 outline-none focus:ring-2 focus:ring-indigo-500 transition-all" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} />
            {authError && <p className="text-red-400 text-xs text-center font-bold animate-pulse">{authError}</p>}
            <button onClick={handleAuth} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-5 rounded-3xl transition-all shadow-xl active:scale-95 text-xs uppercase tracking-[0.2em]">
              {authMode === 'login' ? t('auth_btn_login') : t('auth_btn_register')}
            </button>
            <p className="text-slate-500 text-[10px] text-center cursor-pointer hover:text-indigo-400 mt-8 font-bold uppercase tracking-widest" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>
              {authMode === 'login' ? t('auth_switch_to_reg') : t('auth_switch_to_login')}
            </p>
          </div>
          <div className="mt-10 flex justify-center items-center gap-2 opacity-40">
            <div className={`w-2 h-2 rounded-full ${peerCount > 0 ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">P2P Mesh: {peerCount} Peers</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-all duration-700 ${currentThemeClass}`}>
      {/* Mesh Health Header (Desktop only) */}
      <div className="fixed top-0 left-0 right-0 h-1 z-50 flex">
        <div className={`h-full transition-all duration-1000 ${peerCount > 0 ? 'bg-indigo-500' : 'bg-red-500 animate-pulse'}`} style={{ width: `${Math.min(100, peerCount * 25)}%` }} />
      </div>

      <nav className={`w-24 border-r flex flex-col items-center py-10 gap-10 shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
        <div className="w-14 h-14 cursor-pointer hover:scale-110 mb-6 transition-all" onClick={() => setActiveView(FluxurView.CHATS)}><ICONS.Logo className="drop-shadow-lg" /></div>
        <button onClick={() => setActiveView(FluxurView.CHATS)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.CHATS ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Message /></button>
        <button onClick={() => setActiveView(FluxurView.PROFILE)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.PROFILE ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.User /></button>
        {currentUser?.role === 'developer' && (
          <button onClick={() => setActiveView(FluxurView.ADMIN)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.ADMIN ? 'bg-amber-500 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Sparkles /></button>
        )}
        <div className="flex-1" />
        <div className="group relative">
           <div className={`w-3 h-3 rounded-full mb-4 ${peerCount > 0 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`} />
           <div className="absolute left-10 bottom-4 bg-slate-900 text-white text-[8px] px-2 py-1 rounded hidden group-hover:block whitespace-nowrap z-50 font-black uppercase tracking-widest border border-slate-800">Mesh Health: {peerCount}</div>
        </div>
        <button onClick={() => setActiveView(FluxurView.SETTINGS)} className={`p-4 rounded-3xl transition-all ${activeView === FluxurView.SETTINGS ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Settings /></button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activeView === FluxurView.CHATS ? (
          <>
            <aside className={`w-full md:w-96 border-r flex flex-col shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNavTheme}`}>
              <div className="p-8 flex flex-col h-full">
                <div className="flex items-center justify-between mb-10">
                  <h2 className="text-3xl font-black font-outfit tracking-tighter">Fluxur</h2>
                  <div className="flex gap-3">
                    <button onClick={() => setShowCreateModal('group')} className="p-3 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded-2xl transition-all shadow-sm"><ICONS.Plus className="w-5 h-5" /></button>
                    <button onClick={() => setShowCreateModal('channel')} className="p-3 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-2xl transition-all shadow-sm"><ICONS.Message className="w-5 h-5" /></button>
                  </div>
                </div>
                <div className="relative mb-8">
                  <ICONS.Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="text" placeholder={t('chat_search')} className="w-full text-sm py-4 pl-12 pr-6 rounded-2xl bg-slate-800/20 border border-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium" value={chatSearchQuery} onChange={(e) => setChatSearchQuery(e.target.value)} />
                </div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {searchResults.map(chat => {
                    const isJoined = chat.participants.includes(currentUser?.id || '');
                    return (
                      <div key={chat.id} 
                        onClick={() => handleJoinChat(chat)} 
                        className={`p-5 rounded-[2rem] cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xl scale-[0.97]' : 'hover:bg-indigo-500/5 border-transparent hover:scale-[0.99]'} relative overflow-hidden group`}>
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-black text-sm truncate">{chat.name}</span>
                          {!isJoined && <span className="text-[7px] bg-indigo-400 text-white px-2 py-0.5 rounded-full font-black uppercase">Open</span>}
                        </div>
                        <p className={`text-[11px] truncate ${activeChatId === chat.id ? 'text-indigo-100' : 'text-slate-500'}`}>{chat.lastMessage || t('msg_no_messages')}</p>
                        {!isJoined && (
                          <div className="absolute inset-0 bg-indigo-600/95 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] font-black uppercase tracking-widest text-white">Enter Chat</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                        <div className="w-12 h-12 bg-indigo-600/20 rounded-2xl flex items-center justify-center font-black text-indigo-400 shadow-inner">
                          {activeChat.name[0]}
                        </div>
                        <div>
                          <h3 className="font-black text-xl font-outfit leading-tight">{activeChat.name}</h3>
                          <p className="text-[10px] text-indigo-500 font-black uppercase tracking-[0.2em] mt-1">{activeChat.handle || activeChat.type}</p>
                        </div>
                      </div>
                    </div>
                    {(currentUser?.id === activeChat.creatorId || currentUser?.role === 'developer') && (
                      <button onClick={() => setShowModModal(true)} className="px-6 py-3 bg-slate-800 hover:bg-indigo-600 text-white rounded-[1.2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-xl">
                        {t('mod_title')}
                      </button>
                    )}
                  </header>

                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">
                    {activeChat.messages.map(m => (
                      <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                        <div className={`max-w-[80%] md:max-w-[70%] p-5 rounded-[2rem] shadow-2xl relative ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-800/80 text-slate-100 border border-slate-700 rounded-tl-none'}`}>
                          <p className="text-[10px] font-black opacity-30 mb-2 uppercase tracking-widest">{m.senderName}</p>
                          <p className="text-sm md:text-base leading-relaxed font-medium">{m.text}</p>
                          <p className={`text-[8px] font-black opacity-20 mt-3 text-right`}>{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <footer className="p-10 pt-0">
                    <div className="border border-slate-800 rounded-[2.5rem] p-3 flex items-center gap-3 bg-slate-900/60 shadow-inner backdrop-blur-2xl">
                      <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder={t('chat_input_placeholder')} className="flex-1 bg-transparent border-none outline-none px-6 py-4 text-sm font-semibold" />
                      <button onClick={handleSendMessage} className="p-5 bg-indigo-600 text-white rounded-[1.5rem] shadow-2xl hover:bg-indigo-500 transition-all active:scale-75"><ICONS.Send className="w-6 h-6" /></button>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30 select-none animate-in fade-in duration-1000">
                  <ICONS.Logo className="w-72 h-72 mb-8 grayscale opacity-50" />
                  <p className="font-outfit font-black text-5xl uppercase tracking-tighter">Fluxur Messenger</p>
                  <p className="text-sm font-black mt-3 tracking-[0.5em] uppercase text-indigo-500">{t('chat_no_select')}</p>
                </div>
              )}
            </main>
          </>
        ) : (
          <div className="flex-1 p-16 flex items-center justify-center animate-in zoom-in-90 duration-500">
             <div className="bg-slate-900/40 border border-slate-800 p-20 rounded-[5rem] text-center max-w-lg w-full shadow-[0_40px_100px_rgba(0,0,0,0.6)] backdrop-blur-md relative overflow-hidden group">
                <input type="file" ref={profileAvatarInputRef} className="hidden" accept="image/*" onChange={handleProfileAvatarSelect} />
                <div className="relative inline-block mb-10 cursor-pointer group/avatar" onClick={() => profileAvatarInputRef.current?.click()}>
                  <div className="absolute inset-0 bg-black/40 rounded-[4rem] flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity z-10">
                    <span className="text-white text-[10px] font-black uppercase tracking-widest">Update Photo</span>
                  </div>
                  <img src={currentUser?.avatar} className="w-48 h-48 rounded-[4rem] shadow-2xl border-4 border-indigo-600/20 object-cover group-hover:scale-105 transition-transform" />
                </div>
                <h2 className="text-5xl font-black font-outfit mb-3 tracking-tighter">{currentUser?.name}</h2>
                <p className="text-indigo-500 font-black tracking-[0.3em] text-sm mb-16 uppercase">@{currentUser?.login}</p>
                <div className="flex gap-4 mb-8 justify-center">
                   <div className="bg-slate-800 px-4 py-2 rounded-xl text-[10px] font-black uppercase">P2P ID: {currentUser?.id}</div>
                </div>
                <button onClick={() => { localStorage.removeItem(SESSION_STORAGE_KEY); window.location.reload(); }} className="w-full py-6 bg-red-600/10 text-red-500 rounded-[2rem] font-black uppercase tracking-[0.4em] hover:bg-red-600 hover:text-white transition-all shadow-xl text-xs">
                  {t('profile_logout')}
                </button>
             </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-50 flex items-center justify-center p-6 animate-in zoom-in-95 duration-500">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-[4rem] p-12 shadow-2xl">
            <h3 className="text-4xl font-black font-outfit mb-10 uppercase tracking-tighter text-center">Create {showCreateModal}</h3>
            <div className="space-y-6 mb-12">
              <input type="text" placeholder="Chat Name" className="w-full bg-slate-800 border-2 border-slate-700 rounded-[1.5rem] py-5 px-8 outline-none focus:border-indigo-500 text-white font-bold text-lg transition-all" value={newName} onChange={e => setNewName(e.target.value)} />
              <div className="relative">
                <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold">@</span>
                <input type="text" placeholder="unique-id" className="w-full bg-slate-800 border-2 border-slate-700 rounded-[1.5rem] py-5 pl-10 pr-8 outline-none focus:border-indigo-500 text-white font-bold text-lg transition-all" value={newHandle} onChange={e => setNewHandle(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setShowCreateModal(null)} className="flex-1 py-5 text-slate-500 font-black uppercase text-[10px] tracking-[0.3em]">{t('modal_cancel')}</button>
              <button onClick={handleCreateChat} className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.8rem] font-black uppercase text-[10px] tracking-[0.4em] shadow-2xl">{t('modal_create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
