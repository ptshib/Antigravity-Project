// Fichier : src/services/schoolMessagingService.ts
import { supabase } from '../lib/supabase';

export interface MessagingContact {
  profile_id: string;
  full_name: string;
  role: 'teacher' | 'parent';
  subject_id: string | null;
  subject_name: string | null;
  is_homeroom: boolean;
}

export interface MessagingConversation {
  conversation_id: string;
  school_id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  counterparty_profile_id: string;
  counterparty_name: string;
  counterparty_role: 'teacher' | 'parent';
  subject_name: string | null;
  status: 'active' | 'read_only';
  is_archived: boolean;
  last_message_content: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface MessagingMessage {
  message_id: string;
  conversation_id: string;
  sender_profile_id: string;
  sender_name: string;
  content: string;
  created_at: string;
  is_mine: boolean;
}

export type SendMessageResult =
  | {
      success: true;
      message: {
        id: string;
        conversation_id: string;
        sender_profile_id: string;
        content: string;
        created_at: string;
      };
    }
  | {
      success: false;
      code: 'CONVERSATION_READ_ONLY' | string;
      message: string;
    };

export const schoolMessagingService = {
  /**
   * Récupère les contacts autorisés pour un élève donné.
   */
  async getContacts(studentId: string): Promise<MessagingContact[]> {
    const { data, error } = await supabase.rpc('get_messaging_contacts', {
      p_student_id: studentId
    });

    if (error) {
      throw new Error(error.message || 'Impossible de récupérer les contacts autorisés.');
    }

    return (data || []) as MessagingContact[];
  },

  /**
   * Obtient ou crée la conversation unique pour un élève, une contrepartie et une matière optionnelle.
   */
  async getOrCreateConversation(
    studentId: string,
    counterpartyProfileId: string,
    subjectId: string | null = null
  ): Promise<string> {
    const { data, error } = await supabase.rpc('get_or_create_school_conversation', {
      p_student_id: studentId,
      p_counterparty_profile_id: counterpartyProfileId,
      p_subject_id: subjectId
    });

    if (error) {
      throw new Error(error.message || 'Erreur lors de l ouverture de la conversation.');
    }

    return data as string;
  },

  /**
   * Liste toutes les conversations de l'utilisateur avec métadonnées et non-lus.
   */
  async getConversations(): Promise<MessagingConversation[]> {
    const { data, error } = await supabase.rpc('get_school_conversations');

    if (error) {
      throw new Error(error.message || 'Impossible de charger la liste des conversations.');
    }

    return (data || []).map((c: any) => ({
      ...c,
      unread_count: Number(c.unread_count || 0)
    })) as MessagingConversation[];
  },

  /**
   * Récupère les messages paginés d'une conversation.
   * Transmet obligatoirement p_before_created_at ET p_before_id ensemble s'ils sont fournis.
   */
  async getMessages(
    conversationId: string,
    beforeCreatedAt: string | null = null,
    beforeId: string | null = null,
    limit: number = 30
  ): Promise<MessagingMessage[]> {
    const params: Record<string, any> = {
      p_conversation_id: conversationId,
      p_limit: limit
    };

    if (beforeCreatedAt && beforeId) {
      params.p_before_created_at = beforeCreatedAt;
      params.p_before_id = beforeId;
    }

    const { data, error } = await supabase.rpc('get_school_conversation_messages', params);

    if (error) {
      throw new Error(error.message || 'Impossible de charger les messages.');
    }

    return (data || []) as MessagingMessage[];
  },

  /**
   * Envoie un message dans la conversation et retourne le contrat JSONB métier.
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResult> {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 3000) {
      throw new Error('Le message doit contenir entre 1 et 3000 caractères.');
    }

    const { data, error } = await supabase.rpc('send_school_message', {
      p_conversation_id: conversationId,
      p_content: trimmed
    });

    if (error) {
      throw new Error(error.message || 'Erreur lors de l envoi du message.');
    }

    return data as SendMessageResult;
  },

  /**
   * Marque la conversation comme lue pour l'appelant.
   */
  async markRead(conversationId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('mark_school_conversation_read', {
      p_conversation_id: conversationId
    });

    if (error) {
      console.warn('Erreur lors du marquage comme lu :', error);
      return false;
    }

    return !!data;
  },

  /**
   * Modifie l'état d'archivage individuel d'une conversation.
   */
  async setArchived(conversationId: string, archived: boolean): Promise<boolean> {
    const { data, error } = await supabase.rpc('set_school_conversation_archived', {
      p_conversation_id: conversationId,
      p_archived: archived
    });

    if (error) {
      throw new Error(error.message || 'Erreur lors de la modification de l archivage.');
    }

    return !!data;
  },

  /**
   * Récupère le compteur de messages non lus pour une conversation.
   */
  async getUnreadCount(conversationId: string): Promise<number> {
    const { data, error } = await supabase.rpc('get_school_conversation_unread_count', {
      p_conversation_id: conversationId
    });

    if (error) {
      return 0;
    }

    return Number(data || 0);
  }
};
