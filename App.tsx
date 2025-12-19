
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView, FileAttachment } from './types';
import { ICONS, COLORS } from './constants';
import { translations } from './translations';
import { chatWithAssistant, summarizeConversation } from './geminiService';

/**
 * Fluxur Cloud Architecture v12.0
 * Используем набор самых стабильных реле в качестве "Облачного сервера".
 */
const CLOUD_RELAYS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://relay.peer.ooo/gun',
  'https://gun-us-west.herokuapp.com/gun',
  'https://gun-eu-west.herokuapp.com/gun',
  'https://fluxur-relay-p2p.herokuapp.com/gun',
  'https://peer.wall.org/gun',
  'https://dletta.herokuapp.com/gun',
  'https://gun-ams1.marda.io/gun',
  'https://gun-sjc1.marda.io/gun',
  'https://gunjs.herokuapp.com/gun'
];

const gun = (window as any).Gun({
  peers: CLOUD_RELAYS,
  localStorage: true,
  radisk: true // Включаем расширенное хранилище
});

// Уникальный ключ для этой версии сети, чтобы избежать конфликтов со старыми данными
const SERVER_ROOT_KEY = 'fluxur_v12_cloud_stable'; 
const SESSION_KEY = 'fluxur_v12_session';
const server = gun.get(SERVER_ROOT_KEY);

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
    const saved = localStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const [activeView, setActiveView] = useState<FluxurView>(() => {
    return localStorage.getItem(SESSION_KEY) ? FluxurView.CHATS : FluxurView.AUTH;
  });

  const [registeredUsers, setRegisteredUsers] = useState<User[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isCloudSynced, setIsCloudSynced] = useState(false);
  const [peerCount, setPeerCount] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState<'group' | 'channel' | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement>(null);

  const [newName, setNewName] = useState('');
  const [newHandle, setNewHandle] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', login: '', password: '', avatar: DEFAULT_AVATAR });
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // --- Ядро синхронизации (Cloud Sync Core) ---
  useEffect(() => {
    // Мониторинг подключений
    const peerCheck = setInterval(() => {
      const peers = (gun as any)._?.opt?.peers || {};
      const active = Object.keys(peers).filter(k => peers[k].wire?.readyState === 1).length;
      setPeerCount(active);
      if (active > 0) setIsCloudSynced(true);
    }, 2000);

    // 1. Подписываемся на ГЛОБАЛЬНЫЙ список пользователей (Cloud Users)
    server.get('cloud_users').map().on((userData: any) => {
      if (userData && userData.id) {
        setRegisteredUsers(prev => {
          const others = prev.filter(u => u.id !== userData.id);
          return [...others, userData];
        });
        // Если это наш профиль и он обновился в облаке - синхронизируем локально
        if (currentUser && userData.id === currentUser.id) {
          if (JSON.stringify(userData) !== JSON.stringify(currentUser)) {
            setCurrentUser(userData);
            localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
          }
        }
      }
    });

    // 2. Подписываемся на ГЛОБАЛЬНЫЙ список чатов (Cloud Chats)
    server.get('cloud_chats').map().on((chatData: any) => {
      if (chatData && chatData.id) {
        try {
          const parsed: Chat = {
            ...chatData,
            participants: JSON.parse(chatData.participants || '[]'),
            messages: JSON.parse(chatData.messages || '[]')
          };
          setChats(prev => {
            const others = prev.filter(c => c.id !== parsed.id);
            return [...others, parsed];
          });
        } catch (e) { console.error("Cloud decode err", e); }
      }
    });

    return () => clearInterval(peerCheck);
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

  const handleAuth = async () => {
    setAuthError('');
    setIsLoading(true);
    const login = authForm.login.trim().toLowerCase();

    if (authMode === 'register') {
      if (!authForm.name || !authForm.login || !authForm.password) {
        setAuthError(t('auth_err_fields'));
        setIsLoading(false);
        return;
      }

      // Проверяем занятость логина в Облаке
      server.get('logins').get(login).once((existingId) => {
        if (existingId) {
          setAuthError(t('auth_err_taken'));
          setIsLoading(false);
        } else {
          const uid = Math.random().toString(36).substr(2, 9);
          const isDev = login === DEVELOPER_LOGIN;
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

          // Сохраняем в облако
          server.get('cloud_users').get(uid).put(newUser);
          server.get('logins').get(login).put(uid);

          setCurrentUser(newUser);
          localStorage.setItem(SESSION_KEY, JSON.stringify(newUser));
          setActiveView(FluxurView.CHATS);
          setIsLoading(false);
        }
      });
    } else {
      // Логин (Cloud Auth)
      server.get('logins').get(login).once((uid) => {
        if (uid) {
          server.get('cloud_users').get(uid).once((user: any) => {
            if (user && user.password === authForm.password) {
              setCurrentUser(user);
              localStorage.setItem(SESSION_KEY, JSON.stringify(user));
              setActiveView(FluxurView.CHATS);
            } else {
              setAuthError(t('auth_err_invalid'));
            }
            setIsLoading(false);
          });
        } else {
          setAuthError(t('auth_err_invalid'));
          setIsLoading(false);
        }
      });
    }
  };

  const handleCreateChat = () => {
    if (!newName.trim() || !currentUser) return;
    const cid = Math.random().toString(36).substr(2, 9);
    const handle = newHandle ? `@${newHandle.replace('@', '').toLowerCase()}` : undefined;

    const newChat: Chat = {
      id: cid,
      name: newName.trim(),
      handle: handle,
      type: showCreateModal || 'group',
      participants: [currentUser.id],
      messages: [],
      creatorId: currentUser.id
    };

    // Публикуем в облако
    const putData = {
      ...newChat,
      participants: JSON.stringify(newChat.participants),
      messages: JSON.stringify(newChat.messages)
    };

    server.get('cloud_chats').get(cid).put(putData);
    if (handle) server.get('handles').get(handle).put(cid);

    setActiveChatId(cid);
    setShowCreateModal(null);
    setNewName('');
    setNewHandle('');
  };

  const handleSendMessage = useCallback(() => {
    const activeChat = chats.find(c => c.id === activeChatId);
    if (!inputText.trim() || !currentUser || !activeChat) return;

    const msg: Message = {
      id: Math.random().toString(36).substr(2, 9) + Date.now(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: inputText,
      timestamp: new Date()
    };

    const updatedMessages = [...activeChat.messages, msg].slice(-100);

    // Обновляем чат в облаке
    server.get('cloud_chats').get(activeChat.id).put({
      messages: JSON.stringify(updatedMessages),
      lastMessage: inputText
    });

    setInputText('');
  }, [inputText, activeChatId, chats, currentUser]);

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);
  
  // Чаты, которые мы видим: те, где мы участвуем, или публичные каналы
  const myVisibleChats = useMemo(() => {
    if (!currentUser) return [];
    return chats.filter(c => 
      c.participants.includes(currentUser.id) || c.type === 'channel'
    );
  }, [chats, currentUser]);

  const currentTheme = THEMES[currentUser?.theme || 'dark'];
  const currentNav = NAV_THEMES[currentUser?.theme || 'dark'];

  if (activeView === FluxurView.AUTH) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-slate-950 p-6 text-white overflow-hidden relative">
        {/* Animated Background Orbs */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full animate-pulse delay-1000" />
        
        <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-3xl border border-white/10 rounded-[3.5rem] p-12 shadow-2xl relative z-10 animate-in zoom-in-95 duration-700">
          <div className="flex flex-col items-center mb-12 text-center">
            <ICONS.Logo className="w-24 h-24 mb-6 drop-shadow-[0_0_30px_rgba(34,211,238,0.4)]" />
            <h1 className="text-6xl font-outfit font-black tracking-tighter bg-gradient-to-r from-cyan-400 to-indigo-500 bg-clip-text text-transparent italic">Fluxur</h1>
            <p className="text-slate-400 text-sm mt-3 uppercase tracking-[0.3em] font-bold opacity-60">Cloud Messenger</p>
          </div>

          <div className="space-y-4">
            {authMode === 'register' && (
              <div className="flex flex-col items-center mb-6">
                <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const r = new FileReader();
                    r.onload = () => setAuthForm({...authForm, avatar: r.result as string});
                    r.readAsDataURL(file);
                  }
                }} />
                <div onClick={() => avatarInputRef.current?.click()} className="w-24 h-24 rounded-[2rem] border-2 border-dashed border-white/20 flex items-center justify-center overflow-hidden cursor-pointer hover:border-indigo-500 transition-all group relative">
                  <img src={authForm.avatar} className="w-full h-full object-cover group-hover:scale-110 transition-transform" alt="Avatar" />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <ICONS.Plus className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
            )}

            <input 
              type="text" 
              placeholder={authMode === 'register' ? t('auth_name') : t('auth_login')} 
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 px-8 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-semibold"
              value={authMode === 'register' ? authForm.name : authForm.login}
              onChange={e => authMode === 'register' ? setAuthForm({...authForm, name: e.target.value}) : setAuthForm({...authForm, login: e.target.value})}
            />

            {authMode === 'register' && (
              <input 
                type="text" 
                placeholder={t('auth_login')} 
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 px-8 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-semibold"
                value={authForm.login}
                onChange={e => setAuthForm({...authForm, login: e.target.value})}
              />
            )}

            <input 
              type="password" 
              placeholder={t('auth_pass')} 
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 px-8 outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-semibold"
              value={authForm.password}
              onChange={e => setAuthForm({...authForm, password: e.target.value})}
            />

            {authError && <p className="text-red-400 text-xs text-center font-black uppercase tracking-widest animate-pulse">{authError}</p>}

            <button 
              disabled={isLoading}
              onClick={handleAuth} 
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black py-6 rounded-3xl transition-all shadow-xl shadow-indigo-500/20 active:scale-95 text-xs uppercase tracking-[0.4em] mt-6"
            >
              {isLoading ? 'Processing Cloud...' : (authMode === 'login' ? t('auth_btn_login') : t('auth_btn_register'))}
            </button>

            <p className="text-slate-500 text-[10px] text-center cursor-pointer hover:text-white mt-10 font-black uppercase tracking-[0.2em] transition-colors" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>
              {authMode === 'login' ? t('auth_switch_to_reg') : t('auth_switch_to_login')}
            </p>
          </div>

          <div className="mt-12 flex flex-col items-center gap-2 opacity-30">
             <div className="flex items-center gap-2">
               <div className={`w-2 h-2 rounded-full ${peerCount > 0 ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
               <span className="text-[10px] font-black uppercase tracking-widest">{peerCount > 0 ? 'Cloud Server Active' : 'Connecting to Server...'}</span>
             </div>
             <p className="text-[8px] font-medium max-w-[200px] text-center italic">Encryption active. All data stored in Fluxur Mesh Cloud.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-all duration-700 ${currentTheme}`}>
      {/* Cloud Status Header */}
      <div className="fixed top-0 left-0 right-0 h-[2px] z-[100] flex">
        <div className={`h-full transition-all duration-1000 ${isCloudSynced ? 'bg-indigo-500 shadow-[0_0_10px_#6366f1]' : 'bg-red-500 animate-pulse'}`} style={{ width: isCloudSynced ? '100%' : '30%' }} />
      </div>

      <nav className={`w-24 border-r flex flex-col items-center py-10 gap-10 shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNav}`}>
        <div className="w-14 h-14 cursor-pointer hover:scale-110 mb-6 transition-all" onClick={() => setActiveView(FluxurView.CHATS)}><ICONS.Logo className="drop-shadow-lg" /></div>
        <button onClick={() => setActiveView(FluxurView.CHATS)} className={`p-4 rounded-[1.5rem] transition-all ${activeView === FluxurView.CHATS ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Message /></button>
        <button onClick={() => setActiveView(FluxurView.PROFILE)} className={`p-4 rounded-[1.5rem] transition-all ${activeView === FluxurView.PROFILE ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.User /></button>
        <div className="flex-1" />
        <div className="group relative cursor-help">
          <div className={`w-3 h-3 rounded-full mb-6 ${peerCount > 0 ? 'bg-emerald-500 animate-pulse shadow-[0_0_15px_#10b981]' : 'bg-red-500'}`} />
          <div className="absolute left-14 bottom-8 bg-black text-white text-[8px] p-2 rounded hidden group-hover:block whitespace-nowrap z-50 font-black uppercase tracking-widest border border-white/10">Cloud Sync: {peerCount} Nodes</div>
        </div>
        <button onClick={() => setActiveView(FluxurView.SETTINGS)} className={`p-4 rounded-[1.5rem] transition-all ${activeView === FluxurView.SETTINGS ? 'bg-indigo-600 text-white shadow-2xl scale-110' : 'opacity-30 hover:opacity-100 hover:scale-105'}`}><ICONS.Settings /></button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activeView === FluxurView.CHATS ? (
          <>
            <aside className={`w-full md:w-96 border-r flex flex-col shrink-0 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentNav}`}>
              <div className="p-8 flex flex-col h-full">
                <div className="flex items-center justify-between mb-10">
                  <h2 className="text-3xl font-black font-outfit tracking-tighter italic text-indigo-500">Fluxur</h2>
                  <div className="flex gap-3">
                    <button onClick={() => setShowCreateModal('group')} className="p-3 bg-white/5 hover:bg-indigo-600 text-indigo-400 hover:text-white rounded-2xl transition-all"><ICONS.Plus className="w-5 h-5" /></button>
                    <button onClick={() => setShowCreateModal('channel')} className="p-3 bg-white/5 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-2xl transition-all"><ICONS.Message className="w-5 h-5" /></button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                  {myVisibleChats.map(chat => (
                    <div key={chat.id} 
                      onClick={() => setActiveChatId(chat.id)} 
                      className={`p-6 rounded-[2.5rem] cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xl scale-[0.98]' : 'hover:bg-white/5 border-transparent'}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-black text-base truncate">{chat.name}</span>
                        {chat.type === 'channel' && <span className="text-[7px] bg-white/10 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">Global</span>}
                      </div>
                      <p className={`text-xs truncate opacity-40 font-medium ${activeChatId === chat.id ? 'text-white/80' : ''}`}>{chat.lastMessage || 'Cloud: Encrypted data...'}</p>
                    </div>
                  ))}
                  {myVisibleChats.length === 0 && (
                    <div className="text-center py-24 opacity-10">
                      <ICONS.Logo className="w-16 h-16 mx-auto mb-4 grayscale" />
                      <p className="text-[10px] font-black uppercase tracking-[0.5em]">Searching Cloud...</p>
                    </div>
                  )}
                </div>
              </div>
            </aside>

            <main className={`flex-1 flex-col ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
              {activeChat ? (
                <>
                  <header className="h-24 border-b border-white/5 px-10 flex items-center justify-between bg-white/5 backdrop-blur-3xl">
                    <div className="flex items-center gap-5">
                      <button onClick={() => setActiveChatId(null)} className="md:hidden p-3 hover:bg-white/5 rounded-full"><ICONS.Back /></button>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-600/30 rounded-[1.2rem] flex items-center justify-center font-black text-indigo-400 italic">
                          {activeChat.name[0]}
                        </div>
                        <div>
                          <h3 className="font-black text-xl font-outfit leading-tight">{activeChat.name}</h3>
                          <p className="text-[9px] text-indigo-500 font-black uppercase tracking-[0.2em] mt-1">{activeChat.handle || 'Cloud Shared'}</p>
                        </div>
                      </div>
                    </div>
                  </header>

                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-10 space-y-6 custom-scrollbar">
                    {activeChat.messages.map(m => (
                      <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                        <div className={`max-w-[80%] p-5 rounded-[2.2rem] shadow-2xl relative ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white/5 text-slate-100 border border-white/10 rounded-tl-none'}`}>
                          <p className="text-[9px] font-black opacity-30 mb-2 uppercase tracking-widest">{m.senderName}</p>
                          <p className="text-sm md:text-base font-medium leading-relaxed">{m.text}</p>
                          <p className="text-[8px] font-black opacity-20 mt-3 text-right">{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <footer className="p-10 pt-0">
                    <div className="bg-white/5 border border-white/10 rounded-[2.8rem] p-3 flex items-center gap-3 shadow-2xl">
                      <input 
                        value={inputText} 
                        onChange={e => setInputText(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && handleSendMessage()} 
                        placeholder="Cloud transmission..." 
                        className="flex-1 bg-transparent border-none outline-none px-6 py-4 text-sm font-semibold placeholder:opacity-30" 
                      />
                      <button onClick={handleSendMessage} className="p-5 bg-indigo-600 text-white rounded-[2rem] shadow-xl hover:bg-indigo-500 transition-all active:scale-75"><ICONS.Send className="w-6 h-6" /></button>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30 select-none">
                  <ICONS.Logo className="w-64 h-64 mb-10 grayscale opacity-40 animate-pulse" />
                  <p className="font-outfit font-black text-4xl uppercase tracking-tighter italic">Fluxur Messenger</p>
                  <p className="text-[10px] font-black mt-4 tracking-[0.8em] uppercase text-indigo-500">Accessing Secure Cloud</p>
                </div>
              )}
            </main>
          </>
        ) : (
          <div className="flex-1 p-16 flex items-center justify-center">
             <div className="bg-white/5 border border-white/10 p-20 rounded-[5rem] text-center max-w-lg w-full shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-10"><ICONS.Logo className="w-40 h-40" /></div>
                <div className="relative inline-block mb-10">
                  <img src={currentUser?.avatar} className="w-48 h-48 rounded-[4rem] shadow-2xl border-4 border-indigo-600/30 object-cover" />
                </div>
                <h2 className="text-5xl font-black font-outfit mb-3 tracking-tighter italic">{currentUser?.name}</h2>
                <p className="text-indigo-500 font-black tracking-[0.4em] text-sm mb-16 uppercase opacity-60">@{currentUser?.login}</p>
                
                <div className="grid grid-cols-2 gap-4 mb-10">
                  <div className="bg-black/40 p-5 rounded-[2rem] border border-white/5 text-center">
                    <p className="text-[8px] font-black uppercase text-slate-500 mb-2">Cloud Node</p>
                    <p className="text-[10px] font-black text-indigo-400">#FX-{currentUser?.id.toUpperCase()}</p>
                  </div>
                  <div className="bg-black/40 p-5 rounded-[2rem] border border-white/5 text-center">
                    <p className="text-[8px] font-black uppercase text-slate-500 mb-2">Security</p>
                    <p className="text-[10px] font-black text-emerald-400">LEVEL 7 AES</p>
                  </div>
                </div>

                <button onClick={() => { localStorage.removeItem(SESSION_KEY); window.location.reload(); }} className="w-full py-6 bg-red-600/10 text-red-500 rounded-[2.5rem] font-black uppercase tracking-[0.5em] hover:bg-red-600 hover:text-white transition-all text-[10px]">
                  Disconnect Cloud
                </button>
             </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[200] flex items-center justify-center p-6 animate-in zoom-in-95 duration-500">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-[4.5rem] p-16 shadow-[0_0_100px_rgba(0,0,0,1)]">
            <h3 className="text-4xl font-black font-outfit mb-12 uppercase tracking-tighter text-center italic text-indigo-500">Initialize {showCreateModal}</h3>
            <div className="space-y-8 mb-16">
              <div className="space-y-3">
                <p className="text-[9px] font-black uppercase tracking-[0.4em] text-slate-500 ml-4">Registry Name</p>
                <input type="text" placeholder="Fluxur Channel..." className="w-full bg-white/5 border border-white/10 rounded-[1.8rem] py-6 px-10 outline-none focus:border-indigo-500 text-white font-bold text-lg transition-all" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div className="space-y-3">
                <p className="text-[9px] font-black uppercase tracking-[0.4em] text-slate-500 ml-4">Global Handle</p>
                <div className="relative">
                  <span className="absolute left-8 top-1/2 -translate-y-1/2 text-slate-500 font-bold">@</span>
                  <input type="text" placeholder="tech-hub" className="w-full bg-white/5 border border-white/10 rounded-[1.8rem] py-6 pl-12 pr-10 outline-none focus:border-indigo-500 text-white font-bold text-lg transition-all" value={newHandle} onChange={e => setNewHandle(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="flex gap-6">
              <button onClick={() => setShowCreateModal(null)} className="flex-1 py-6 text-slate-500 font-black uppercase text-[10px] tracking-[0.4em] hover:text-white transition-all">{t('modal_cancel')}</button>
              <button onClick={handleCreateChat} className="flex-1 py-6 bg-indigo-600 text-white rounded-[2.2rem] font-black uppercase text-[10px] tracking-[0.5em] shadow-2xl hover:bg-indigo-500 active:scale-90 transition-all">Establish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
