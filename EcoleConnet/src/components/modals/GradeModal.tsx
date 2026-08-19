import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import { MOCK_STUDENTS } from '../../data/mockData';

interface GradeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GradeModal: React.FC<GradeModalProps> = ({ isOpen, onClose }) => {
  const { addGrade } = useDemo();
  const { showToast } = useNotifications();

  const [studentId, setStudentId] = useState(MOCK_STUDENTS[0].id);
  const [subject, setSubject] = useState('Mathématiques');
  const [score, setScore] = useState<number>(18);
  const [maxScore] = useState<number>(20);
  const [coefficient, setCoefficient] = useState<number>(3);
  const [title, setTitle] = useState('Interrogation écrite N°2');
  const [teacherComment, setTeacherComment] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const student = MOCK_STUDENTS.find(s => s.id === studentId);
    if (!student) return;

    addGrade({
      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`,
      subject,
      score,
      maxScore,
      period: '1er Trimestre',
      teacherComment: teacherComment || 'Bon travail.',
      coefficient
    });

    showToast(`Note ${score}/${maxScore} attribuée à ${student.firstName} en ${subject}`, 'success');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Saisir une note d'évaluation"
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
            Enregistrer la note
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Élève concerné *</label>
          <select
            value={studentId}
            onChange={e => setStudentId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all cursor-pointer"
          >
            {MOCK_STUDENTS.map(s => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName} ({s.className})
              </option>
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Note (sur 20) *</label>
            <input
              type="number"
              min="0"
              max="20"
              step="0.5"
              value={score}
              onChange={e => setScore(parseFloat(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-bold text-amber-700 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Coefficient *</label>
            <input
              type="number"
              min="1"
              max="5"
              value={coefficient}
              onChange={e => setCoefficient(parseInt(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Intitulé de l'évaluation *</label>
          <input
            type="text"
            placeholder="Ex: Interrogation écrite N°2"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Appréciation / Remarque</label>
          <textarea
            rows={2}
            placeholder="Observations sur le travail de l'élève..."
            value={teacherComment}
            onChange={e => setTeacherComment(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 hover:border-slate-400 transition-all"
          />
        </div>
      </form>
    </Modal>
  );
};
