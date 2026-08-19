import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import { MOCK_CLASSES } from '../../data/mockData';

interface HomeworkModalProps {
  isOpen: boolean;
  onClose: () => void;
  teacherName?: string;
}

export const HomeworkModal: React.FC<HomeworkModalProps> = ({
  isOpen,
  onClose,
  teacherName = 'Mme. Clarisse Mbuyi'
}) => {
  const { createHomework } = useDemo();
  const { showToast } = useNotifications();

  const [classId, setClassId] = useState(MOCK_CLASSES[2].id);
  const [subject, setSubject] = useState('Mathématiques');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('2026-08-20');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) {
      showToast('Veuillez remplir le titre et la description du devoir', 'warning');
      return;
    }

    const targetClass = MOCK_CLASSES.find(c => c.id === classId);

    createHomework({
      classId,
      className: targetClass?.name || '1re Secondaire A',
      subject,
      title,
      description,
      dueDate,
      teacherName
    });

    showToast(`Devoir "${title}" publié pour la classe ${targetClass?.name}`, 'success');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Nouveau devoir à rendre"
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
            Publier le devoir
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Classe ciblée *</label>
          <select
            value={classId}
            onChange={e => setClassId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all cursor-pointer"
          >
            {MOCK_CLASSES.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Matière *</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Titre du devoir *</label>
          <input
            type="text"
            placeholder="Ex: Exercices sur le théorème de Pythagore"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Instructions détaillées</label>
          <textarea
            rows={3}
            placeholder="Détail des exercices, consignes et critères d'évaluation..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Date limite de remise *</label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>
      </form>
    </Modal>
  );
};
