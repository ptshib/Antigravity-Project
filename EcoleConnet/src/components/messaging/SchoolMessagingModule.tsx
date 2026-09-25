// Fichier : src/components/messaging/SchoolMessagingModule.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Archive,
  ArchiveRestore,
  Send,
  AlertCircle,
  X,
  CheckCheck,
  ChevronLeft,
  Loader2,
  Lock
} from 'lucide-react';
import {
  schoolMessagingService,
  type MessagingConversation,
  type MessagingMessage,
  type MessagingContact
} from '../../services/schoolMessagingService';

export interface SchoolMessagingModuleProps {
  mode: 'teacher' | 'parent';
  selectedChildId?: string;
  childrenList?: Array<{ id: string; first_name: string; last_name: string; class_name?: string }>;
  onSelectChildId?: (childId: string) => void;
  assignedClasses?: Array<{ class_id: string; class_name: string; is_homeroom?: boolean }>;
  assignedStudentsMap?: Record<string, Array<{ id: string; first_name: string; last_name: string; student_number?: string }>>;
}

export const SchoolMessagingModule: React.FC<SchoolMessagingModuleProps> = ({
  mode,
  selectedChildId,
  childrenList = [],
  onSelectChildId,
  assignedClasses = [],
  assignedStudentsMap = {}
}) => {
  // State principal
  const [conversations, setConversations] = useState<MessagingConversation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'archived'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Fil de discussion sélectionné
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessagingMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(true);

  // Formulaire d'envoi
  const [messageInput, setMessageInput] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [readOnlyNotice, setReadOnlyNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Modale Nouvelle Conversation
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [newModalStudentId, setNewModalStudentId] = useState<string>(selectedChildId || '');
  const [newModalClassId, setNewModalClassId] = useState<string>('');
  const [contacts, setContacts] = useState<MessagingContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState<boolean>(false);
  const [selectedContact, setSelectedContact] = useState<MessagingContact | null>(null);
  const [creatingConv, setCreatingConv] = useState<boolean>(false);

  // Ref pour scroll et gestion des réponses obsolètes
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentFetchReqId = useRef<number>(0);
  const contactsReqIdRef = useRef<number>(0);

  // Réinitialiser la sélection et le fil quand l'enfant sélectionné change (Mode Parent)
  useEffect(() => {
    if (mode === 'parent') {
      setSelectedConvId(null);
      setMessages([]);
      setMessagesError(null);
      setReadOnlyNotice(null);
      setSendError(null);
    }
  }, [selectedChildId, mode]);

  // Écouteur de touche Échap pour la modale
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showNewModal) {
        setShowNewModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showNewModal]);

  // Charger les conversations
  const loadConversations = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const data = await schoolMessagingService.getConversations();
      setConversations(data);
    } catch (err: any) {
      if (!quiet) {
        if (err?.code === '42501' || err?.message?.includes('permission denied')) {
          setError("Accès refusé. Vous n'avez pas les autorisations nécessaires pour accéder à cette messagerie.");
        } else {
          setError(err.message || 'Impossible de charger vos conversations.');
        }
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Polling automatique de rafraîchissement (toutes les 25s)
  useEffect(() => {
    const interval = setInterval(() => {
      loadConversations(true);
    }, 25000);

    return () => clearInterval(interval);
  }, [loadConversations]);

  // Charger les messages du fil sélectionné
  const loadMessages = useCallback(async (convId: string) => {
    const reqId = ++currentFetchReqId.current;
    setLoadingMessages(true);
    setMessagesError(null);
    setReadOnlyNotice(null);
    setHasMore(true);

    try {
      const data = await schoolMessagingService.getMessages(convId, null, null, 30);
      if (reqId === currentFetchReqId.current) {
        setMessages(data);
        if (data.length < 30) setHasMore(false);

        // Marquer la conversation comme lue
        await schoolMessagingService.markRead(convId);
        // Mettre à jour le compteur localement
        setConversations(prev =>
          prev.map(c => (c.conversation_id === convId ? { ...c, unread_count: 0 } : c))
        );
      }
    } catch (err: any) {
      if (reqId === currentFetchReqId.current) {
        setMessagesError(err.message || 'Erreur lors du chargement des messages.');
      }
    } finally {
      if (reqId === currentFetchReqId.current) {
        setLoadingMessages(false);
      }
    }
  }, []);

  const handleSelectConversation = (convId: string) => {
    setSelectedConvId(convId);
    loadMessages(convId);
  };

  // Charger plus de messages (pagination déterministe)
  const handleLoadMore = async () => {
    if (!selectedConvId || messages.length === 0 || loadingMore || !hasMore) return;

    const oldestMsg = messages[messages.length - 1];
    setLoadingMore(true);

    try {
      const older = await schoolMessagingService.getMessages(
        selectedConvId,
        oldestMsg.created_at,
        oldestMsg.message_id,
        30
      );

      if (older.length < 30) setHasMore(false);
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.message_id));
        const filteredOlder = older.filter(m => !existingIds.has(m.message_id));
        return [...prev, ...filteredOlder];
      });
    } catch (err: any) {
      // notification silencieuse
    } finally {
      setLoadingMore(false);
    }
  };

  // Envoi de message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConvId || !messageInput.trim() || sending) return;

    const textToSend = messageInput.trim();
    setSending(true);
    setReadOnlyNotice(null);
    setSendError(null);

    try {
      const res = await schoolMessagingService.sendMessage(selectedConvId, textToSend);

      if (res.success) {
        setMessageInput('');
        const newMsgRow: MessagingMessage = {
          message_id: res.message.id,
          conversation_id: res.message.conversation_id,
          sender_profile_id: res.message.sender_profile_id,
          sender_name: 'Moi',
          content: res.message.content,
          created_at: res.message.created_at,
          is_mine: true
        };
        setMessages(prev => [newMsgRow, ...prev]);
        await loadConversations(true);
      } else {
        // Refus métier CONVERSATION_READ_ONLY
        setReadOnlyNotice(res.message);
        setConversations(prev =>
          prev.map(c =>
            c.conversation_id === selectedConvId ? { ...c, status: 'read_only' } : c
          )
        );
      }
    } catch (err: any) {
      setSendError(err.message || 'Impossible d envoyer le message.');
    } finally {
      setSending(false);
    }
  };

  // Archivage / Désarchivage
  const handleToggleArchive = async (convId: string, currentArchived: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await schoolMessagingService.setArchived(convId, !currentArchived);
      setConversations(prev =>
        prev.map(c =>
          c.conversation_id === convId ? { ...c, is_archived: !currentArchived } : c
        )
      );
    } catch (err: any) {
      // Erreur archivage
    }
  };

  // Modale Nouvelle Conversation - Charger contacts
  const handleLoadContacts = async (studentId: string) => {
    if (!studentId) {
      setContacts([]);
      setSelectedContact(null);
      return;
    }
    const reqId = ++contactsReqIdRef.current;
    setLoadingContacts(true);
    setSelectedContact(null);
    try {
      const data = await schoolMessagingService.getContacts(studentId);
      if (reqId === contactsReqIdRef.current) {
        setContacts(data);
      }
    } catch (err: any) {
      if (reqId === contactsReqIdRef.current) {
        setContacts([]);
      }
    } finally {
      if (reqId === contactsReqIdRef.current) {
        setLoadingContacts(false);
      }
    }
  };

  // Ouverture modale
  const handleOpenNewModal = () => {
    setShowNewModal(true);
    setSelectedContact(null);
    setContacts([]);
    if (mode === 'parent' && selectedChildId) {
      setNewModalStudentId(selectedChildId);
      handleLoadContacts(selectedChildId);
    } else if (mode === 'teacher' && assignedClasses.length > 0) {
      setNewModalClassId(assignedClasses[0].class_id);
    }
  };

  // Création effectuée via RPC get_or_create
  const handleCreateConversationSubmit = async () => {
    if (!newModalStudentId || !selectedContact || creatingConv) return;

    setCreatingConv(true);
    try {
      const convId = await schoolMessagingService.getOrCreateConversation(
        newModalStudentId,
        selectedContact.profile_id,
        selectedContact.subject_id
      );

      setShowNewModal(false);
      await loadConversations();
      handleSelectConversation(convId);
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la création de la conversation.');
    } finally {
      setCreatingConv(false);
    }
  };

  // Isolation par enfant en mode Parent
  const displayedConversations = conversations.filter(c => {
    if (mode === 'parent' && selectedChildId && c.student_id !== selectedChildId) {
      return false;
    }
    return true;
  });

  // Filtrage des conversations (onglets et recherche)
  const filteredConversations = displayedConversations.filter(c => {
    if (activeFilter === 'unread' && (c.unread_count || 0) === 0) return false;
    if (activeFilter === 'archived' && !c.is_archived) return false;
    if (activeFilter !== 'archived' && c.is_archived) return false;

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchName = (c.counterparty_name || '').toLowerCase().includes(q);
      const matchStudent = (c.student_name || '').toLowerCase().includes(q);
      const matchClass = (c.class_name || '').toLowerCase().includes(q);
      const matchSubject = (c.subject_name || '').toLowerCase().includes(q);
      return matchName || matchStudent || matchClass || matchSubject;
    }

    return true;
  });

  const totalUnreadCount = displayedConversations.reduce((acc, c) => acc + (c.is_archived ? 0 : (c.unread_count || 0)), 0);
  const selectedConv = conversations.find(c => c.conversation_id === selectedConvId);

  return (
    <div className="space-y-4 animate-fade-in font-sans">
      {/* En-tête Principal */}
      <div className="p-5 bg-white border border-slate-200 rounded-3xl shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold text-slate-900">Messagerie Scolaire</h2>
              {totalUnreadCount > 0 && (
                <span data-testid="total-unread-badge" className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-500 text-white shadow-xs">
                  {totalUnreadCount} non lu{totalUnreadCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'teacher'
                ? 'Échangez en toute sécurité avec les responsables légaux autorisés'
                : 'Communiquez directement avec les enseignants de votre enfant'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={() => loadConversations()}
            disabled={loading}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Rafraîchir"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Actualiser</span>
          </button>

          <button
            type="button"
            onClick={handleOpenNewModal}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nouvelle Conversation</span>
          </button>
        </div>
      </div>

      {/* Disposition à 2 Panneaux (Liste + Fil) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[600px]">
        {/* PANNEAU GAUCHE : Liste des conversations (Col 12 sur Mobile / Col 5 sur Desktop) */}
        <div
          className={`lg:col-span-5 bg-white rounded-3xl border border-slate-200 shadow-xs flex flex-col overflow-hidden ${
            selectedConvId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Barres d'onglets et recherche */}
          <div className="p-4 border-b border-slate-100 space-y-3 bg-slate-50/50">
            <div className="flex items-center gap-1 p-1 bg-slate-200/60 rounded-2xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`flex-1 py-1.5 rounded-xl transition-all ${
                  activeFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Toutes
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('unread')}
                className={`flex-1 py-1.5 rounded-xl transition-all flex items-center justify-center gap-1 ${
                  activeFilter === 'unread'
                    ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>Non lues</span>
                {totalUnreadCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('archived')}
                className={`flex-1 py-1.5 rounded-xl transition-all ${
                  activeFilter === 'archived'
                    ? 'bg-white text-slate-900 shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Archivées
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher interlocuteur, élève, classe..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Corps de la liste */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-[500px]">
            {loading ? (
              <div data-testid="messaging-skeleton" className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse flex items-start gap-3 p-3 bg-slate-50 rounded-2xl">
                    <div className="w-10 h-10 bg-slate-200 rounded-full shrink-0"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                      <div className="h-2 bg-slate-200 rounded w-3/4"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="p-8 text-center space-y-3 text-slate-500">
                <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
                <p className="text-xs font-bold text-slate-700">{error}</p>
                <button
                  onClick={() => loadConversations()}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Réessayer
                </button>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 space-y-2">
                <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="font-bold text-slate-700">Aucune conversation trouvée</p>
                <p className="text-[11px] text-slate-400">
                  {activeFilter === 'unread'
                    ? 'Vous n aviez aucun message non lu.'
                    : activeFilter === 'archived'
                    ? 'Aucune conversation archivée.'
                    : 'Cliquez sur "Nouvelle Conversation" pour démarrer un échange.'}
                </p>
              </div>
            ) : (
              filteredConversations.map(c => {
                const isSelected = selectedConvId === c.conversation_id;
                const isReadOnly = c.status === 'read_only';
                const initial = (c.counterparty_name || '?').charAt(0).toUpperCase();

                return (
                  <div
                    key={c.conversation_id}
                    onClick={() => handleSelectConversation(c.conversation_id)}
                    className={`p-4 flex items-start justify-between gap-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-amber-50/70 border-l-4 border-amber-500'
                        : c.unread_count > 0
                        ? 'bg-slate-50/90 hover:bg-slate-100/80 font-bold'
                        : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-2xl bg-slate-200 text-slate-700 font-extrabold flex items-center justify-center text-xs shrink-0 border border-slate-300">
                        {initial}
                      </div>

                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-extrabold text-slate-900 truncate">
                            {c.counterparty_name}
                          </p>
                          {isReadOnly && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-slate-200 text-slate-700 border border-slate-300">
                              Lecture seule
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 flex-wrap">
                          <span className="font-bold text-slate-700">{c.student_name}</span>
                          <span>•</span>
                          <span>{c.class_name}</span>
                          {c.subject_name && (
                            <>
                              <span>•</span>
                              <span className="text-amber-700 font-bold">{c.subject_name}</span>
                            </>
                          )}
                        </div>

                        {c.last_message_content && (
                          <p className="text-[11px] text-slate-600 truncate max-w-xs">
                            {c.last_message_content}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {c.last_message_at && (
                        <span className="text-[10px] font-mono text-slate-400">
                          {new Date(c.last_message_at).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      )}

                      <div className="flex items-center gap-1.5">
                        {c.unread_count > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white">
                            {c.unread_count}
                          </span>
                        )}

                        <button
                          type="button"
                          data-testid={`archive-btn-${c.conversation_id}`}
                          onClick={e => handleToggleArchive(c.conversation_id, c.is_archived, e)}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                          title={c.is_archived ? 'Désarchiver' : 'Archiver'}
                        >
                          {c.is_archived ? (
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANNEAU DROIT : Fil de discussion actif (Col 12 sur Mobile / Col 7 sur Desktop) */}
        <div
          className={`lg:col-span-7 bg-white rounded-3xl border border-slate-200 shadow-xs flex flex-col overflow-hidden ${
            !selectedConvId ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {selectedConvId && selectedConv ? (
            <>
              {/* Header du fil */}
              <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedConvId(null)}
                    className="lg:hidden p-1.5 bg-slate-200 hover:bg-slate-300 rounded-xl text-slate-700 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 font-extrabold flex items-center justify-center text-xs shrink-0">
                    {(selectedConv.counterparty_name || '?').charAt(0).toUpperCase()}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs sm:text-sm font-extrabold text-slate-900">
                        {selectedConv.counterparty_name}
                      </h3>
                      {selectedConv.status === 'read_only' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 text-slate-700 border border-slate-300 flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          <span>Lecture seule</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Élève : <strong className="text-slate-800">{selectedConv.student_name}</strong> ({selectedConv.class_name})
                      {selectedConv.subject_name
                        ? ` • Matière : ${selectedConv.subject_name}`
                        : mode === 'teacher'
                        ? ' • Titulaire de classe'
                        : ''}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => loadMessages(selectedConvId)}
                  className="p-2 text-slate-400 hover:text-slate-700 rounded-xl transition-colors"
                  title="Actualiser les messages"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingMessages ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Conteneur des Messages */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[420px] bg-slate-50/30">
                {/* Bouton de chargement précédent */}
                {hasMore && messages.length >= 30 && (
                  <div className="text-center py-2">
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-colors cursor-pointer inline-flex items-center gap-2"
                    >
                      {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Charger les messages précédents</span>
                    </button>
                  </div>
                )}

                {loadingMessages ? (
                  <div className="p-8 text-center space-y-3">
                    <Loader2 className="w-6 h-6 text-amber-500 animate-spin mx-auto" />
                    <p className="text-xs text-slate-500 font-medium">Chargement des messages sécurisés...</p>
                  </div>
                ) : messagesError ? (
                  <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-2 text-rose-800">
                    <AlertCircle className="w-5 h-5 mx-auto text-rose-600" />
                    <p className="text-xs font-bold">{messagesError}</p>
                    <button
                      onClick={() => loadMessages(selectedConvId)}
                      className="px-3 py-1 bg-rose-600 text-white font-bold text-xs rounded-lg"
                    >
                      Réessayer
                    </button>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 space-y-1">
                    <p className="font-bold text-slate-600">Aucun message pour l instant</p>
                    <p>Tapez votre premier message ci-dessous pour démarrer la discussion.</p>
                  </div>
                ) : (
                  [...messages].reverse().map(m => (
                    <div
                      key={m.message_id}
                      className={`flex flex-col ${m.is_mine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[75%] p-3.5 rounded-2xl text-xs space-y-1 ${
                          m.is_mine
                            ? 'bg-slate-900 text-white rounded-tr-none shadow-xs'
                            : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none shadow-xs'
                        }`}
                      >
                        {!m.is_mine && (
                          <p className="text-[10px] font-extrabold text-amber-700 block mb-0.5">
                            {m.sender_name}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap break-words leading-relaxed">
                          {m.content}
                        </p>
                        <span
                          className={`text-[9px] font-mono block text-right ${
                            m.is_mine ? 'text-slate-400' : 'text-slate-400'
                          }`}
                        >
                          {new Date(m.created_at).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Notice Read Only si applicable */}
              {(selectedConv.status === 'read_only' || readOnlyNotice) && (
                <div className="p-3 bg-amber-50 border-t border-amber-200 text-amber-900 text-xs font-bold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-700 shrink-0" />
                  <p className="flex-1">
                    {readOnlyNotice ||
                      'Cette conversation est désormais en lecture seule car la relation scolaire n est plus active.'}
                  </p>
                </div>
              )}

              {/* Erreur technique d'envoi RPC */}
              {sendError && (
                <div className="p-3 bg-rose-50 border-t border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{sendError}</span>
                  </div>
                  <button type="button" onClick={() => setSendError(null)} className="p-1 text-rose-500 hover:text-rose-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Formulaire d'envoi */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-100 bg-white space-y-2">
                <div className="flex items-end gap-2">
                  <textarea
                    rows={2}
                    placeholder={
                      selectedConv.status === 'read_only'
                        ? 'Envois désactivés (Lecture seule)'
                        : 'Écrivez votre message (1 à 3 000 caractères)...'
                    }
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                    disabled={selectedConv.status === 'read_only' || sending}
                    maxLength={3000}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 resize-none disabled:bg-slate-100 disabled:text-slate-400"
                  />

                  <button
                    type="submit"
                    data-testid="send-message-btn"
                    disabled={
                      selectedConv.status === 'read_only' ||
                      !messageInput.trim() ||
                      sending
                    }
                    className="p-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-slate-950 disabled:text-slate-400 rounded-2xl font-black transition-all cursor-pointer disabled:cursor-not-allowed shrink-0"
                    title="Envoyer"
                  >
                    {sending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5" />
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 font-mono">
                  <span>Appuyez sur Entrée pour formater votre message</span>
                  <span>{messageInput.trim().length} / 3000 car.</span>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3 text-slate-400 bg-slate-50/20">
              <div className="w-12 h-12 rounded-3xl bg-slate-100 text-slate-400 flex items-center justify-center">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="font-extrabold text-slate-700 text-sm">Sélectionnez une conversation</h3>
              <p className="text-xs text-slate-500 max-w-sm">
                Choisissez un fil de discussion dans le panneau de gauche ou cliquez sur "Nouvelle Conversation" pour ouvrir un nouvel échange.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* MODALE NOUVELLE CONVERSATION */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-slate-100 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-extrabold text-slate-900">Nouvelle Conversation</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Étape 1 : Sélection de l'Élève */}
            <div className="space-y-3">
              <label className="text-xs font-extrabold text-slate-700 block">
                {mode === 'parent' ? '1. Sélectionnez votre enfant' : '1. Sélectionnez la classe & l élève'}
              </label>

              {mode === 'parent' ? (
                <select
                  value={newModalStudentId}
                  onChange={e => {
                    setNewModalStudentId(e.target.value);
                    if (onSelectChildId) onSelectChildId(e.target.value);
                    handleLoadContacts(e.target.value);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold p-3 rounded-xl focus:outline-none focus:border-amber-500"
                >
                  <option value="">-- Choisir un enfant --</option>
                  {childrenList.map(ch => (
                    <option key={ch.id} value={ch.id}>
                      {ch.first_name} {ch.last_name} {ch.class_name ? `(${ch.class_name})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2">
                  <select
                    data-testid="select-class-dropdown"
                    value={newModalClassId}
                    onChange={e => {
                      setNewModalClassId(e.target.value);
                      setNewModalStudentId('');
                      setContacts([]);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold p-2.5 rounded-xl focus:outline-none focus:border-amber-500"
                  >
                    <option value="">-- Sélectionner une classe attribuée --</option>
                    {assignedClasses.map(ac => (
                      <option key={ac.class_id} value={ac.class_id}>
                        {ac.class_name} {ac.is_homeroom ? '(Titulaire)' : ''}
                      </option>
                    ))}
                  </select>

                  {newModalClassId && (
                    <select
                      data-testid="select-student-dropdown"
                      value={newModalStudentId}
                      onChange={e => {
                        setNewModalStudentId(e.target.value);
                        handleLoadContacts(e.target.value);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold p-2.5 rounded-xl focus:outline-none focus:border-amber-500"
                    >
                      <option value="">-- Choisir l élève concerné --</option>
                      {(assignedStudentsMap[newModalClassId] || []).map(st => (
                        <option key={st.id} value={st.id}>
                          {st.first_name} {st.last_name} {st.student_number ? `(${st.student_number})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

            {/* Étape 2 : Liste des contacts autorisés par la RPC */}
            {newModalStudentId && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                <label className="text-xs font-extrabold text-slate-700 block">
                  2. Destinataire autorisé (retourné par le serveur)
                </label>

                {loadingContacts ? (
                  <div className="p-4 text-center text-xs text-slate-500 space-y-2">
                    <Loader2 className="w-5 h-5 text-amber-500 animate-spin mx-auto" />
                    <p>Chargement des contacts autorisés...</p>
                  </div>
                ) : contacts.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-center text-xs text-slate-500">
                    Aucun contact autorisé retourné pour cet élève.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {contacts.map(ct => {
                      const isSel = selectedContact?.profile_id === ct.profile_id && selectedContact?.subject_id === ct.subject_id;

                      return (
                        <div
                          key={`${ct.profile_id}-${ct.subject_id || 'homeroom'}`}
                          data-testid={`contact-option-${ct.profile_id}`}
                          onClick={() => setSelectedContact(ct)}
                          className={`p-3 rounded-2xl border text-xs cursor-pointer flex items-center justify-between transition-colors ${
                            isSel
                              ? 'bg-amber-50 border-amber-500 text-slate-900 font-extrabold'
                              : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <div>
                            <p className="font-bold">{ct.full_name}</p>
                            <p className="text-[10px] text-slate-500">
                              {ct.subject_name
                                ? `Matière : ${ct.subject_name}`
                                : ct.is_homeroom
                                ? 'Titulaire de classe'
                                : 'Responsable Légal'}
                            </p>
                          </div>
                          {isSel && <CheckCheck className="w-4 h-4 text-amber-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Actions modale */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={handleCreateConversationSubmit}
                disabled={!selectedContact || creatingConv}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-slate-950 disabled:text-slate-400 text-xs font-black rounded-xl transition-colors cursor-pointer flex items-center gap-2"
              >
                {creatingConv && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Ouvrir la conversation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
