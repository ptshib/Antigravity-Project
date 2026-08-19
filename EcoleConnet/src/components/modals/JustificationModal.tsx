import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useNotifications } from '../../context/NotificationContext';
import { Paperclip, UploadCloud } from 'lucide-react';

interface JustificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentName: string;
}

export const JustificationModal: React.FC<JustificationModalProps> = ({
  isOpen,
  onClose,
  studentName
}) => {
  const { showToast } = useNotifications();
  const [reason, setReason] = useState('');
  const [fileName, setFileName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      showToast('Veuillez préciser le motif de l’absence.', 'warning');
      return;
    }

    showToast(`Justificatif d’absence soumis avec succès pour ${studentName}.`, 'success');
    setReason('');
    setFileName('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Envoyer un justificatif d’absence — ${studentName}`}
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
            Soumettre le justificatif
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Motif de l'absence / retard *</label>
          <textarea
            rows={3}
            required
            placeholder="Ex: Consultation médicale ou indisposition..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Pièce justificative (Billet médical / Attestation)</label>
          <div className="p-4 border-2 border-dashed border-slate-300 hover:border-amber-500 rounded-2xl bg-slate-50 text-center cursor-pointer relative transition-colors">
            <UploadCloud className="w-8 h-8 text-amber-600 mx-auto mb-1" />
            <p className="text-xs font-bold text-slate-800">Cliquez pour téléverser un fichier (PDF, PNG, JPG)</p>
            <p className="text-[10px] text-slate-500">Taille maximale : 5 MB</p>
            <input
              type="file"
              onChange={e => setFileName(e.target.files?.[0]?.name || '')}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </div>
          {fileName && (
            <p className="text-xs font-bold text-emerald-700 mt-2 flex items-center gap-1">
              <Paperclip className="w-3.5 h-3.5" />
              <span>Fichier sélectionné : {fileName}</span>
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
};
