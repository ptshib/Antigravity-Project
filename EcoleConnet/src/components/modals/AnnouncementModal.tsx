import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';

interface AnnouncementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AnnouncementModal: React.FC<AnnouncementModalProps> = ({ isOpen, onClose }) => {
  const { addAnnouncement } = useDemo();
  const { addNotification, showToast } = useNotifications();
  const { user, role } = useAuth();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'normal' | 'important' | 'urgent'>('important');
  const [targetRole, setTargetRole] = useState<string>('all');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) {
      showToast('Veuillez remplir tous les champs de l’annonce', 'warning');
      return;
    }

    addAnnouncement({
      title,
      content,
      authorName: user?.name || 'Administration',
      authorRole: role === 'admin' ? 'Proviseur' : 'Enseignant',
      priority,
      targetRole: targetRole as any
    });

    addNotification(`Nouvelle annonce: ${title}`, content.substring(0, 80) + '...', priority as any);
    showToast('Annonce publiée avec succès !', 'success');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Publier une nouvelle annonce"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            className="px-5 py-2 text-sm font-bold text-slate-950 bg-amber-500 hover:bg-amber-600 rounded-xl shadow-xs cursor-pointer"
          >
            Publier l'annonce
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Titre de l'annonce *</label>
          <input
            type="text"
            placeholder="Ex: Convocation à la réunion des parents..."
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Niveau d'urgence</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'normal', label: 'Normale', color: 'bg-slate-200 text-slate-900 border-slate-400' },
              { id: 'important', label: 'Importante', color: 'bg-amber-100 text-amber-900 border-amber-400' },
              { id: 'urgent', label: 'Urgente', color: 'bg-rose-100 text-rose-900 border-rose-400' }
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPriority(p.id as any)}
                className={`py-2.5 rounded-xl text-xs font-bold border-2 transition-all cursor-pointer ${
                  priority === p.id ? `${p.color} ring-4 ring-amber-500/20` : 'bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Public ciblé</label>
          <select
            value={targetRole}
            onChange={e => setTargetRole(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all cursor-pointer"
          >
            <option value="all">Tous (Parents, Élèves, Enseignants)</option>
            <option value="parent">Parents uniquement</option>
            <option value="teacher">Enseignants uniquement</option>
            <option value="student">Élèves uniquement</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Contenu du message *</label>
          <textarea
            rows={4}
            placeholder="Rédigez l'annonce officielle..."
            value={content}
            onChange={e => setContent(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>
      </form>
    </Modal>
  );
};
