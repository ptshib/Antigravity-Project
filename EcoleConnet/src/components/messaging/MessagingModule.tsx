import React, { useState } from 'react';
import { useDemo } from '../../context/DemoContext';
import { useAuth } from '../../context/AuthContext';
import { Search, Send, Paperclip, CheckCheck, Phone } from 'lucide-react';
import { SCHOOL_INFO } from '../../data/mockData';

export const MessagingModule: React.FC = () => {
  const { conversations, messages, sendMessage } = useDemo();
  const { user, role } = useAuth();
  const [selectedConvId, setSelectedConvId] = useState(conversations[0]?.id || 'conv_1');
  const [inputText, setInputText] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const activeConv = conversations.find(c => c.id === selectedConvId) || conversations[0];
  const activeMessages = messages[selectedConvId] || [];

  const filteredConversations = conversations.filter(c =>
    c.participantName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    sendMessage(
      selectedConvId,
      inputText.trim(),
      user?.id || 'usr_current',
      user?.name || 'Mme. Marie Kabedi',
      role || 'parent'
    );

    setInputText('');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-[calc(100vh-170px)] flex flex-col md:flex-row">
      {/* Sidebar - Conversation List */}
      <div className="w-full md:w-80 border-r border-slate-200 flex flex-col bg-slate-50/50">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-bold text-slate-900 text-lg mb-3">Messagerie interne</h3>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Rechercher un contact..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredConversations.map(conv => {
            const isSelected = conv.id === selectedConvId;
            return (
              <button
                key={conv.id}
                onClick={() => setSelectedConvId(conv.id)}
                className={`w-full p-4 flex items-start gap-3 transition-colors text-left cursor-pointer ${
                  isSelected ? 'bg-blue-50/80 border-l-4 border-blue-600' : 'hover:bg-slate-100/60'
                }`}
              >
                <img
                  src={conv.participantAvatar}
                  alt={conv.participantName}
                  className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs text-slate-900 truncate">{conv.participantName}</h4>
                    <span className="text-[10px] text-slate-400 shrink-0">{conv.lastMessageTime}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate mt-1">{conv.lastMessage}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Chat Window */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Chat Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/30">
          <div className="flex items-center gap-3">
            <img
              src={activeConv?.participantAvatar}
              alt={activeConv?.participantName}
              className="w-10 h-10 rounded-full object-cover border border-slate-200"
            />
            <div>
              <h4 className="font-bold text-sm text-slate-900">{activeConv?.participantName}</h4>
              <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                En ligne
              </p>
            </div>
          </div>

          <a
            href={`https://wa.me/${SCHOOL_INFO.whatsapp.replace(/[^0-9]/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-semibold border border-emerald-200 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>Discuter sur WhatsApp</span>
          </a>
        </div>

        {/* Message Stream */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-50/20">
          {activeMessages.map(msg => {
            const isMe = msg.senderId === user?.id || msg.senderRole === role;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-md px-4 py-3 rounded-2xl text-xs shadow-xs leading-relaxed ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none'
                  }`}
                >
                  <p className="font-semibold text-[10px] mb-1 opacity-80">{msg.senderName}</p>
                  <p>{msg.content}</p>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 px-1">
                  {msg.timestamp}
                  {isMe && <CheckCheck className="w-3 h-3 text-blue-500" />}
                </span>
              </div>
            );
          })}
        </div>

        {/* Message Input Box */}
        <form onSubmit={handleSend} className="p-3 border-t border-slate-200 bg-white flex items-center gap-2">
          <button
            type="button"
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            title="Joindre un document (simulé)"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            type="text"
            placeholder="Écrivez votre message..."
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            className="flex-1 px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
          />
          <button
            type="submit"
            className="p-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
