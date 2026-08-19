import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useNotifications } from '../../context/NotificationContext';

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentModal: React.FC<DocumentModalProps> = ({ isOpen, onClose }) => {
  const { showToast } = useNotifications();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'cours' | 'administratif' | 'reglement' | 'bulletin'>('cours');
  const [targetRole, setTargetRole] = useState('Tous');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      showToast('Le titre du document est obligatoire.', 'warning');
      return;
    }

    showToast(`Document "${title}" ajouté avec succès.`, 'success');
    setTitle('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Ajouter un document"
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
            Publier le document
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Titre du document *</label>
          <input
            type="text"
            required
            placeholder="Ex: Support de cours de Physique-Chimie CH2"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Catégorie *</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as any)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all cursor-pointer"
            >
              <option value="cours">Support de Cours</option>
              <option value="administratif">Administratif</option>
              <option value="reglement">Règlement</option>
              <option value="bulletin">Bulletin</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Destinataires *</label>
            <select
              value={targetRole}
              onChange={e => setTargetRole(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all cursor-pointer"
            >
              <option value="Tous">Tous</option>
              <option value="Élèves">Élèves uniquement</option>
              <option value="Parents">Parents uniquement</option>
              <option value="Enseignants">Enseignants uniquement</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Fichier (PDF, DOCX)</label>
          <input
            type="file"
            className="w-full text-xs text-slate-600 border-2 border-slate-300 rounded-xl p-2 bg-slate-50 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-amber-500 file:text-slate-950 hover:file:bg-amber-600 cursor-pointer"
          />
        </div>
      </form>
    </Modal>
  );
};
