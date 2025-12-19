
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { User, Message, Chat, FluxurView } from './types';
import { ICONS, COLORS } from './constants';
import { chatWithAssistant, summarizeConversation } from './geminiService';

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
  
  // Search states
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [showMsgSearch, setShowMsgSearch] = useState(false);

  // Creation UI states
  const [showCreateModal, setShowCreateModal] = useState<'group' | 'channel' | null>(null);
  const [newName, setNewName] = useState('');

  // Auth state
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', login: '', password: '' });
  const [authError, setAuthError] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);

  // Persistence: Load data on mount
  useEffect(() => {
    const savedUsers = localStorage.getItem('fluxur_users');
    const savedChats = localStorage.getItem('fluxur_chats');
    if (savedUsers) setRegisteredUsers(JSON.parse(savedUsers));
    if (savedChats) setChats(JSON.parse(savedChats));
  }, []);

  // Save chats whenever they change (now always saves even if empty to reflect blocks)
  useEffect(() => {
    localStorage.setItem('fluxur_chats', JSON.stringify(chats));
  }, [chats]);

  const activeChat = useMemo(() => chats.find(c => c.id === activeChatId), [chats, activeChatId]);

  // Filtering chats based on sidebar search
  const filteredChats = useMemo(() => {
    if (!chatSearchQuery.trim()) return chats;
    return chats.filter(c => c.name.toLowerCase().includes(chatSearchQuery.toLowerCase()));
  }, [chats, chatSearchQuery]);

  // Filtering messages within the active chat
  const filteredMessages = useMemo(() => {
    if (!activeChat) return [];
    if (!messageSearchQuery.trim()) return activeChat.messages;
    return activeChat.messages.filter(m => m.text.toLowerCase().includes(messageSearchQuery.toLowerCase()));
  }, [activeChat, messageSearchQuery]);

  // Scroll to bottom
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
        setAuthError('Все поля обязательны');
        return;
      }
      if (registeredUsers.find(u => u.login.toLowerCase() === normalizedLogin.toLowerCase())) {
        setAuthError('Этот логин уже занят');
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
        isBlocked: false
      };
      
      const userToSave = { ...newUser, password: authForm.password };
      saveUsersToStorage([...registeredUsers, userToSave]);
      setCurrentUser(newUser);
      setActiveView(FluxurView.CHATS);
    } else {
      const user = registeredUsers.find(u => u.login === normalizedLogin && u.password === authForm.password);
      if (user) {
        if (user.isBlocked) {
          setAuthError('Ваш аккаунт заблокирован администрацией');
          return;
        }
        const { password, ...userWithoutPassword } = user;
        setCurrentUser(userWithoutPassword);
        setActiveView(FluxurView.CHATS);
        
        // Ensure AI chat exists
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
              text: `Привет, ${user.name}! Я твой персональный ИИ Fluxur.`, 
              timestamp: new Date() 
            }],
            creatorId: 'system'
          };
          setChats(prev => [newAiChat, ...prev]);
        }
      } else {
        setAuthError('Неверный логин или пароль');
      }
    }
  };

  const updateCurrentUser = (updates: Partial<User>) => {
    if (!currentUser) return;
    const updatedUser = { ...currentUser, ...updates };
    setCurrentUser(updatedUser);
    const updatedList = registeredUsers.map(u => u.id === currentUser.id ? { ...u, ...updates } : u);
    saveUsersToStorage(updatedList);
  };

  const handleCreateChat = () => {
    if (!newName.trim() || !currentUser || !showCreateModal) return;
    const newChat: Chat = {
      id: Math.random().toString(36).substr(2, 9),
      name: newName,
      type: showCreateModal,
      participants: [currentUser.id],
      messages: [],
      creatorId: currentUser.id,
      isBlocked: false
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setNewName('');
    setShowCreateModal(null);
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || !currentUser || !activeChat) return;
    if (activeChat.isBlocked) return;
    if (activeChat.type === 'channel' && activeChat.creatorId !== currentUser.id && currentUser.role !== 'developer') return;

    const newMessage: Message = {
      id: Date.now().toString(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: inputText,
      timestamp: new Date()
    };

    const updatedChats = chats.map(c => 
      c.id === activeChat.id ? { ...c, messages: [...c.messages, newMessage], lastMessage: inputText } : c
    );
    setChats(updatedChats);
    setInputText('');

    if (activeChat.type === 'ai') {
      setIsTyping(true);
      try {
        const response = await chatWithAssistant(inputText, activeChat.messages);
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          senderId: AI_USER.id,
          senderName: AI_USER.name,
          text: response,
          timestamp: new Date(),
          isAiGenerated: true
        };
        setChats(prev => prev.map(c => 
          c.id === activeChat.id ? { ...c, messages: [...c.messages, aiMessage], lastMessage: response } : c
        ));
      } catch (err) { console.error(err); } 
      finally { setIsTyping(false); }
    }
  }, [inputText, chats, currentUser, activeChat]);

  const handleToggleBlockUser = (userId: string) => {
    const updated = registeredUsers.map(u => u.id === userId ? { ...u, isBlocked: !u.isBlocked } : u);
    saveUsersToStorage(updated);
  };

  const handleBlockChatPermanently = (chatId: string) => {
    // Ensuring the block is saved to both state and implicitly to storage via useEffect
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, isBlocked: true } : c));
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

  if (activeView === FluxurView.AUTH) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-slate-950 p-6 font-inter text-white">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95">
          <div className="flex flex-col items-center mb-8 text-center">
            <ICONS.Logo className="w-24 h-24 mb-4 drop-shadow-[0_0_15px_rgba(34,211,238,0.3)]" />
            <h1 className="text-3xl font-outfit font-bold">Fluxur</h1>
            <p className="text-slate-400 text-sm mt-1">Твое безопасное пространство для общения</p>
          </div>
          <div className="space-y-4">
            {authMode === 'register' && (
              <input type="text" placeholder="Имя" className="w-full bg-slate-800 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} />
            )}
            <input type="text" placeholder="Логин" className="w-full bg-slate-800 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.login} onChange={e => setAuthForm({...authForm, login: e.target.value})} />
            <input type="password" placeholder="Пароль" className="w-full bg-slate-800 rounded-xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-500" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} />
            {authError && <p className="text-red-400 text-xs text-center">{authError}</p>}
            <button onClick={handleAuth} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl shadow-lg transition-all">{authMode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
            <p className="text-slate-500 text-xs text-center cursor-pointer" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? "Нет аккаунта? Регистрация" : "Уже есть аккаунт? Вход"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden font-inter transition-colors duration-300 ${getThemeClasses()}`}>
      {/* Sidebar Rail - Hidden on mobile when chat is open */}
      <nav className={`w-20 border-r flex-col items-center py-8 gap-6 ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentUser?.theme === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-slate-900 border-slate-800'}`}>
        <div className="w-12 h-12 cursor-pointer hover:scale-110 transition-transform" onClick={() => setActiveView(FluxurView.CHATS)}><ICONS.Logo /></div>
        <button onClick={() => setActiveView(FluxurView.CHATS)} className={`p-3 rounded-xl ${activeView === FluxurView.CHATS ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><ICONS.Message /></button>
        <button onClick={() => setActiveView(FluxurView.PROFILE)} className={`p-3 rounded-xl ${activeView === FluxurView.PROFILE ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><ICONS.User /></button>
        {isModerator && <button onClick={() => setActiveView(FluxurView.ADMIN)} className={`p-3 rounded-xl ${activeView === FluxurView.ADMIN ? 'bg-amber-500 text-white' : 'text-slate-500'}`}><ICONS.Sparkles /></button>}
        <div className="flex-1" />
        <button onClick={() => setActiveView(FluxurView.SETTINGS)} className={`p-3 rounded-xl ${activeView === FluxurView.SETTINGS ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}><ICONS.Settings /></button>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {activeView === FluxurView.CHATS ? (
          <>
            {/* Chats List Sidebar - Responsive logic */}
            <aside className={`w-full md:w-80 border-r flex flex-col ${activeChatId ? 'hidden md:flex' : 'flex'} ${currentUser?.theme === 'light' ? 'bg-slate-50' : 'bg-slate-900/50'}`}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-outfit font-bold">Fluxur</h2>
                  <div className="flex gap-2">
                    <button title="New Chat" onClick={() => setShowCreateModal('group')} className="p-2 hover:bg-slate-800 rounded-lg text-indigo-400"><ICONS.Plus className="w-4 h-4" /></button>
                    <button title="New Channel" onClick={() => setShowCreateModal('channel')} className="p-2 hover:bg-slate-800 rounded-lg text-emerald-400"><ICONS.Message className="w-4 h-4" /></button>
                  </div>
                </div>
                
                {/* Chat Search Box */}
                <div className="relative mb-6">
                  <ICONS.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input 
                    type="text" 
                    placeholder="Поиск чатов..." 
                    className={`w-full text-xs py-2.5 pl-10 pr-4 rounded-xl border outline-none focus:ring-2 focus:ring-indigo-500 transition-all ${currentUser?.theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-slate-800 border-slate-700 text-slate-100'}`}
                    value={chatSearchQuery}
                    onChange={(e) => setChatSearchQuery(e.target.value)}
                  />
                </div>

                <div className="space-y-2 overflow-y-auto">
                  {filteredChats.map(chat => (
                    <div key={chat.id} onClick={() => setActiveChatId(chat.id)} className={`p-4 rounded-2xl cursor-pointer transition-all border ${activeChatId === chat.id ? 'bg-indigo-600/10 border-indigo-500/30' : 'hover:bg-slate-800 border-transparent'} ${chat.isBlocked ? 'opacity-50 grayscale' : ''}`}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-sm truncate">{chat.name}</span>
                        {chat.isBlocked && <span className="text-[10px] text-red-400 uppercase font-bold">Blocked</span>}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{chat.lastMessage || 'Нет сообщений'}</p>
                    </div>
                  ))}
                  {filteredChats.length === 0 && (
                    <div className="text-center py-8 text-slate-500 text-xs italic">Ничего не найдено</div>
                  )}
                </div>
              </div>
            </aside>

            {/* Chat View - Responsive logic */}
            <main className={`flex-1 flex-col ${activeChatId ? 'flex' : 'hidden md:flex'}`}>
              {activeChat ? (
                <>
                  <header className="h-20 border-b px-4 md:px-8 flex items-center justify-between backdrop-blur-md">
                    <div className="flex items-center gap-2 md:gap-4 flex-1">
                      {/* Back button for mobile */}
                      <button onClick={() => setActiveChatId(null)} className="md:hidden p-2 hover:bg-slate-800 rounded-lg text-slate-400">
                        <ICONS.Back className="w-6 h-6" />
                      </button>
                      
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shrink-0 ${activeChat.type === 'channel' ? 'bg-emerald-600' : 'bg-indigo-600'}`}>
                        {activeChat.name[0]}
                      </div>
                      <div className="truncate">
                        <h3 className="font-semibold truncate text-sm md:text-base">{activeChat.name}</h3>
                        <p className="text-[10px] text-slate-500">{activeChat.type.toUpperCase()}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 md:gap-4 ml-4">
                      {showMsgSearch ? (
                        <div className="flex items-center gap-2 animate-in slide-in-from-right-2">
                          <input 
                            type="text" 
                            placeholder="Найти..." 
                            className={`text-xs px-3 py-1.5 rounded-lg border outline-none focus:ring-1 focus:ring-indigo-500 ${currentUser?.theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-slate-800 border-slate-700 w-32 md:w-auto'}`}
                            value={messageSearchQuery}
                            onChange={(e) => setMessageSearchQuery(e.target.value)}
                            autoFocus
                          />
                          <button onClick={() => {setShowMsgSearch(false); setMessageSearchQuery('');}} className="text-slate-500 hover:text-white"><ICONS.Plus className="w-4 h-4 rotate-45" /></button>
                        </div>
                      ) : (
                        <button onClick={() => setShowMsgSearch(true)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400"><ICONS.Search className="w-4 h-4" /></button>
                      )}
                      
                      {activeChat.type === 'ai' && (
                        <button onClick={handleSummarize} className="text-xs font-bold text-indigo-400 hover:underline uppercase tracking-tighter">Сводка</button>
                      )}
                    </div>
                  </header>

                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
                    {summary && <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl mb-4 italic text-sm text-indigo-300">"{summary}"</div>}
                    {filteredMessages.map(m => (
                      <div key={m.id} className={`flex ${m.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-2xl ${m.senderId === currentUser?.id ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-100'}`}>
                          <p className="text-[10px] opacity-50 mb-1 font-bold">{m.senderName}</p>
                          <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                        </div>
                      </div>
                    ))}
                    {filteredMessages.length === 0 && messageSearchQuery && (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-500 italic text-sm">
                        <p>Сообщений не найдено</p>
                      </div>
                    )}
                    {isTyping && <div className="text-xs text-indigo-400 animate-pulse">Fluxur печатает...</div>}
                  </div>

                  <footer className="p-4 md:p-6">
                    {activeChat.isBlocked ? (
                      <div className="text-center p-4 bg-red-500/10 text-red-400 rounded-2xl border border-red-500/20 text-sm font-bold">Этот чат заблокирован администрацией</div>
                    ) : activeChat.type === 'channel' && activeChat.creatorId !== currentUser?.id && !isModerator ? (
                      <div className="text-center p-4 text-slate-500 text-sm">Только создатель может отправлять сообщения</div>
                    ) : (
                      <div className={`border rounded-2xl p-2 flex items-center gap-2 ${currentUser?.theme === 'light' ? 'bg-slate-100 border-slate-200' : 'bg-slate-900 border-slate-800'}`}>
                        <textarea rows={1} value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} placeholder="Введите сообщение..." className="flex-1 bg-transparent border-none outline-none px-4 py-2 resize-none" />
                        <button onClick={handleSendMessage} className="p-3 bg-indigo-600 text-white rounded-xl shadow-lg hover:scale-105 transition-transform"><ICONS.Send className="w-5 h-5" /></button>
                      </div>
                    )}
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
                  <ICONS.Logo className="w-32 h-32 mb-4 opacity-20" />
                  <p className="font-outfit font-bold">Fluxur Messenger</p>
                  <p className="text-xs opacity-50 mt-1">Выберите чат или воспользуйтесь поиском</p>
                </div>
              )}
            </main>
          </>
        ) : activeView === FluxurView.ADMIN ? (
          <div className="flex-1 p-6 md:p-12 max-w-5xl mx-auto space-y-12 overflow-y-auto">
            <h1 className="text-3xl md:text-4xl font-outfit font-black text-amber-500">Панель модерации</h1>
            
            <section className="space-y-6">
              <h3 className="text-xl font-bold border-b border-slate-800 pb-2">Пользователи</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {registeredUsers.map(u => (
                  <div key={u.id} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={u.avatar} className={`w-10 h-10 rounded-full ${u.isBlocked ? 'grayscale' : ''}`} />
                      <div>
                        <p className="font-bold text-sm">{u.name} {u.role === 'developer' && '🛠'}</p>
                        <p className="text-xs text-slate-500">@{u.login}</p>
                      </div>
                    </div>
                    {u.login !== DEVELOPER_LOGIN && (
                      <button onClick={() => handleToggleBlockUser(u.id)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${u.isBlocked ? 'bg-emerald-600 text-white' : 'bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white'}`}>
                        {u.isBlocked ? 'Разблокировать' : 'Заблокировать'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-6">
              <h3 className="text-xl font-bold border-b border-slate-800 pb-2">Чаты и каналы</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {chats.filter(c => c.type !== 'ai').map(c => (
                  <div key={c.id} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                    <div>
                      <p className="font-bold text-sm">{c.name}</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{c.type}</p>
                    </div>
                    {c.isBlocked ? (
                      <div className="px-3 py-1.5 bg-red-900/20 border border-red-500/30 rounded-lg text-red-500 text-[10px] font-black uppercase tracking-tighter">
                        Заблокировано навсегда
                      </div>
                    ) : (
                      <button 
                        onClick={() => {
                          if(confirm(`Вы уверены, что хотите заблокировать "${c.name}" навсегда? Восстановление будет невозможно.`)) {
                            handleBlockChatPermanently(c.id);
                          }
                        }} 
                        className="px-4 py-2 rounded-lg text-xs font-bold transition-all bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white"
                      >
                        Блокировать
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : activeView === FluxurView.PROFILE ? (
          <div className="flex-1 p-6 md:p-12 max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 overflow-y-auto">
            <h1 className="text-3xl md:text-4xl font-outfit font-black mb-8">Мой профиль</h1>
            <div className="flex items-center gap-6 p-6 md:p-8 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex-wrap">
              <img src={currentUser?.avatar} className="w-20 h-20 md:w-24 md:h-24 rounded-3xl" />
              <div>
                <h2 className="text-xl md:text-2xl font-bold">{currentUser?.name}</h2>
                <p className="text-slate-500">@{currentUser?.login}</p>
                <div className="flex gap-2 mt-2">
                  {currentUser?.isPremium && <span className="bg-amber-400 text-amber-950 text-[10px] font-black px-2 py-1 rounded-full uppercase">PRO</span>}
                  {currentUser?.role === 'developer' && <span className="bg-indigo-600 text-white text-[10px] font-black px-2 py-1 rounded-full uppercase">DEV</span>}
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <button onClick={() => {setCurrentUser(null); setActiveChatId(null); setActiveView(FluxurView.AUTH);}} className="w-full p-4 bg-red-600/10 text-red-500 rounded-2xl font-bold hover:bg-red-600 hover:text-white transition-all">ВЫЙТИ ИЗ СИСТЕМЫ</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-6 md:p-12 max-w-2xl mx-auto space-y-12 overflow-y-auto">
             <h1 className="text-3xl md:text-4xl font-outfit font-black">Настройки</h1>
             <section className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2">Fluxur Premium</h3>
                <div className="p-6 rounded-3xl border bg-slate-900 border-slate-800">
                   <p className="text-slate-400 text-sm mb-4">Премиум дает доступ к расширенным функциям ИИ и модерации.</p>
                   {currentUser?.premiumStatus === 'active' ? (
                     <div className="text-emerald-500 font-bold">Активно</div>
                   ) : (
                     <button onClick={() => updateCurrentUser({ premiumStatus: 'active', isPremium: true })} className="bg-indigo-600 text-white font-black py-3 px-8 rounded-xl shadow-xl w-full md:w-auto">Получить Premium Бесплатно</button>
                   )}
                </div>
             </section>
             <section className="space-y-4">
                <h3 className="text-lg font-bold">Тема</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   {['dark', 'light', 'midnight'].map(t => (
                     <button key={t} onClick={() => updateCurrentUser({ theme: t as any })} className={`py-4 rounded-2xl border font-bold capitalize ${currentUser?.theme === t ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-500'}`}>{t}</button>
                   ))}
                </div>
             </section>
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-8 animate-in zoom-in-95">
            <h3 className="text-xl font-outfit font-bold mb-4">Создать {showCreateModal === 'channel' ? 'Канал' : 'Чат'}</h3>
            <input type="text" placeholder="Название..." className="w-full bg-slate-800 rounded-xl py-3 px-4 mb-6 outline-none focus:ring-2 focus:ring-indigo-500" value={newName} onChange={e => setNewName(e.target.value)} />
            <div className="flex gap-4">
              <button onClick={() => setShowCreateModal(null)} className="flex-1 py-3 text-slate-500 font-bold">Отмена</button>
              <button onClick={handleCreateChat} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold">Создать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
