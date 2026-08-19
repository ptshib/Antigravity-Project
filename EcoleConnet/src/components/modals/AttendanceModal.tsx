import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import { MOCK_STUDENTS, MOCK_CLASSES } from '../../data/mockData';
import { CheckCheck, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface AttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultClassName?: string;
}

export const AttendanceModal: React.FC<AttendanceModalProps> = ({
  isOpen,
  onClose,
  defaultClassName = '1re Secondaire A'
}) => {
  const { markAttendance } = useDemo();
  const { showToast } = useNotifications();

  const [selectedClassName, setSelectedClassName] = useState(defaultClassName);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

  const classStudents = MOCK_STUDENTS.filter(s => s.className === selectedClassName);

  // Local state map for batch attendance: studentId -> status
  const [attendanceMap, setAttendanceMap] = useState<Record<string, 'present' | 'late' | 'absent'>>(() => {
    const initial: Record<string, 'present' | 'late' | 'absent'> = {};
    classStudents.forEach(s => { initial[s.id] = 'present'; });
    return initial;
  });

  const handleMarkAllPresent = () => {
    const updated: Record<string, 'present' | 'late' | 'absent'> = {};
    classStudents.forEach(s => { updated[s.id] = 'present'; });
    setAttendanceMap(updated);
    showToast('Tous les élèves marqués Présents !', 'info');
  };

  const handleSetStudentStatus = (studentId: string, status: 'present' | 'late' | 'absent') => {
    setAttendanceMap(prev => ({ ...prev, [studentId]: status }));
  };

  const handleSubmitBatch = (e: React.FormEvent) => {
    e.preventDefault();
    let count = 0;
    classStudents.forEach(student => {
      const status = attendanceMap[student.id] || 'present';
      markAttendance(student.id, `${student.firstName} ${student.lastName}`, student.className, status, undefined, selectedDate);
      count++;
    });

    showToast(`Feuille d'appel pour ${selectedClassName} (${count} élèves) enregistrée le ${selectedDate} !`, 'success');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Feuille d'Appel Complète de la Classe"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmitBatch}
            className="px-5 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-600 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            Enregistrer la Feuille d'Appel
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmitBatch} className="space-y-4">
        {/* Controls bar */}
        <div className="grid sm:grid-cols-2 gap-3 pb-3 border-b border-slate-100">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Classe</label>
            <select
              value={selectedClassName}
              onChange={e => {
                const newClass = e.target.value;
                setSelectedClassName(newClass);
                const updated: Record<string, 'present' | 'late' | 'absent'> = {};
                MOCK_STUDENTS.filter(s => s.className === newClass).forEach(s => { updated[s.id] = 'present'; });
                setAttendanceMap(updated);
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {MOCK_CLASSES.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Quick Batch Action */}
        <div className="flex items-center justify-between bg-blue-50/70 p-3 rounded-2xl border border-blue-100">
          <span className="text-xs font-bold text-blue-900">Effectif: {classStudents.length} élèves</span>
          <button
            type="button"
            onClick={handleMarkAllPresent}
            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Marquer tous présents</span>
          </button>
        </div>

        {/* Roster list / mobile compact cards */}
        <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
          {classStudents.map(s => {
            const currentStatus = attendanceMap[s.id] || 'present';
            return (
              <div
                key={s.id}
                className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <img src={s.avatar} alt={s.firstName} className="w-8 h-8 rounded-full object-cover border shrink-0" />
                  <div>
                    <span className="font-bold text-slate-900">{s.firstName} {s.lastName}</span>
                    <span className="text-slate-400 block text-[10px] font-mono">{s.matricule}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={() => handleSetStudentStatus(s.id, 'present')}
                    className={`px-3 py-1.5 rounded-xl font-bold border text-[11px] transition-colors cursor-pointer flex items-center gap-1 ${
                      currentStatus === 'present'
                        ? 'bg-emerald-500 text-white border-emerald-500 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Présent</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetStudentStatus(s.id, 'late')}
                    className={`px-3 py-1.5 rounded-xl font-bold border text-[11px] transition-colors cursor-pointer flex items-center gap-1 ${
                      currentStatus === 'late'
                        ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Retard</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetStudentStatus(s.id, 'absent')}
                    className={`px-3 py-1.5 rounded-xl font-bold border text-[11px] transition-colors cursor-pointer flex items-center gap-1 ${
                      currentStatus === 'absent'
                        ? 'bg-rose-500 text-white border-rose-500 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Absent</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </form>
    </Modal>
  );
};
