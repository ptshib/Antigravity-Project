import React, { useState } from 'react';
import { StatCard } from '../../components/common/StatCard';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import {
  School,
  CalendarCheck,
  BookOpen,
  Award,
  Clock,
  MessageSquare,
  Plus,
  Download,
  Trash2,
  Eye
} from 'lucide-react';
import { MOCK_STUDENTS, MOCK_CLASSES, MOCK_TIMETABLE, MOCK_DOCUMENTS, MOCK_EVENTS } from '../../data/mockData';
import { MessagingModule } from '../../components/messaging/MessagingModule';
import { Modal } from '../../components/common/Modal';
import { DocumentModal } from '../../components/modals/DocumentModal';

interface TeacherDashboardProps {
  activeTab: string;
  onOpenAttendanceModal: () => void;
  onOpenHomeworkModal: () => void;
  onOpenGradeModal: () => void;
  onOpenAnnouncementModal?: () => void;
  onOpenMessaging?: () => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  activeTab,
  onOpenAttendanceModal,
  onOpenHomeworkModal,
  onOpenGradeModal
}) => {
  const { homework, grades, attendance, markAttendance } = useDemo();
  const { showToast } = useNotifications();
  const [selectedClassId, setSelectedClassId] = useState(MOCK_CLASSES[2].id);
  const [showDocModal, setShowDocModal] = useState(false);
  const [deleteHwId, setDeleteHwId] = useState<string | null>(null);
  const [viewSubmissionsHw, setViewSubmissionsHw] = useState<any>(null);

  const teacherClasses = MOCK_CLASSES.filter(c => c.name === '1re Secondaire A' || c.name === '2e Secondaire A');
  const activeClass = MOCK_CLASSES.find(c => c.id === selectedClassId) || teacherClasses[0];
  const classStudents = MOCK_STUDENTS.filter(s => s.className === activeClass.name);

  // 1. Dashboard Overview
  if (activeTab === 'dashboard') {
    return (
      <div className="space-y-8 animate-fade-in">
        {/* Quick Interactive Actions Ribbon */}
        <div className="bg-gradient-to-r from-blue-900 to-blue-800 rounded-3xl p-6 text-white shadow-lg border border-blue-700 flex flex-col lg:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl font-extrabold">Espace Enseignant — Mme Clarisse Mbuyi</h2>
            <p className="text-xs text-blue-200 mt-1">Professeur Titulaire de 1re Secondaire A | Mathématiques & Physique-Chimie</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <button
              onClick={onOpenAttendanceModal}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
            >
              <CalendarCheck className="w-4 h-4" />
              <span>Faire l'appel (Présences)</span>
            </button>

            <button
              onClick={onOpenHomeworkModal}
              className="px-4 py-2.5 bg-white text-blue-900 hover:bg-blue-50 font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
            >
              <BookOpen className="w-4 h-4" />
              <span>Nouveau Devoir</span>
            </button>

            <button
              onClick={onOpenGradeModal}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
            >
              <Award className="w-4 h-4" />
              <span>Saisir une Note</span>
            </button>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard title="Classes Assignées" value="2" subtitle="1re Sec A (35) & 2e Sec A (29)" icon={<School className="w-6 h-6" />} colorScheme="blue" />
          <StatCard title="Cours du jour" value="3" subtitle="2h Math, 1h Physique" icon={<Clock className="w-6 h-6" />} colorScheme="amber" />
          <StatCard title="Devoirs actifs" value={homework.length} subtitle="À corriger sous peu" icon={<BookOpen className="w-6 h-6" />} colorScheme="emerald" />
          <StatCard title="Messages Reçus" value="3" subtitle="Parents & Admin" icon={<MessageSquare className="w-6 h-6" />} colorScheme="purple" />
        </div>

        {/* Assigned Classes & Schedule */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <School className="w-5 h-5 text-blue-600" />
                <span>Mes Classes et Liste des Élèves</span>
              </h3>
              <select
                value={selectedClassId}
                onChange={e => setSelectedClassId(e.target.value)}
                className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-blue-700"
              >
                {teacherClasses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {classStudents.map(s => (
                <div key={s.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={s.avatar} alt={s.firstName} className="w-9 h-9 rounded-full object-cover border" />
                    <div>
                      <h4 className="font-bold text-xs text-slate-900">{s.firstName} {s.lastName}</h4>
                      <p className="text-[10px] text-slate-500 font-mono">{s.matricule}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-emerald-600">Moy: {s.overallAverage}%</span>
                    <button
                      onClick={onOpenAttendanceModal}
                      className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                    >
                      Présence
                    </button>
                    <button
                      onClick={onOpenGradeModal}
                      className="px-2.5 py-1 text-[11px] font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg cursor-pointer"
                    >
                      Noter
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2 pb-3 border-b border-slate-100">
              <Clock className="w-5 h-5 text-amber-500" />
              <span>Emploi du Temps du Jour</span>
            </h3>

            <div className="space-y-3">
              {MOCK_TIMETABLE.filter(t => t.teacherName === 'Mme. Clarisse Mbuyi').slice(0, 3).map(slot => (
                <div key={slot.id} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-blue-700">{slot.subject}</span>
                    <span className="text-[10px] font-bold text-slate-500">{slot.startTime} - {slot.endTime}</span>
                  </div>
                  <p className="text-xs font-medium text-slate-800">{slot.className}</p>
                  <p className="text-[11px] text-slate-400">📍 {slot.room}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Mes classes
  if (activeTab === 'mes_classes') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Mes Classes Assignées</h2>
            <p className="text-xs text-slate-500">Mme Clarisse Mbuyi (1re Secondaire A & 2e Secondaire A)</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {teacherClasses.map(cls => (
            <div key={cls.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900">{cls.name}</h3>
                  <p className="text-xs text-slate-500">Salle : {cls.room} • Effectif : {cls.studentCount} élèves</p>
                </div>
                <span className="px-3 py-1 bg-blue-100 text-blue-800 font-bold text-xs rounded-full">{cls.level}</span>
              </div>

              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {MOCK_STUDENTS.filter(s => s.className === cls.name).map(s => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <img src={s.avatar} alt={s.firstName} className="w-7 h-7 rounded-full object-cover" />
                      <span className="font-bold text-slate-900">{s.firstName} {s.lastName}</span>
                    </div>
                    <span className="font-mono text-slate-500">{s.matricule}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 3. Présences (Feuille d'appel classe)
  if (activeTab === 'presences') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Registre des Présences — Feuille d'Appel Complète</h2>
            <p className="text-xs text-slate-500">Saisie et contrôle de présence en masse pour votre cours</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                classStudents.forEach(s => {
                  markAttendance(s.id, `${s.firstName} ${s.lastName}`, s.className, 'present');
                });
                showToast(`Tous les élèves de ${activeClass.name} marqués présents !`, 'info');
              }}
              className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
            >
              Marquer tous présents
            </button>
            <button
              onClick={() => showToast(`Appel enregistré pour la classe ${activeClass.name} !`, 'success')}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Enregistrer la Feuille d'Appel
            </button>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-base">Élèves de {activeClass.name}</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase">Classe:</span>
              <select
                value={selectedClassId}
                onChange={e => setSelectedClassId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-blue-700"
              >
                {teacherClasses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {classStudents.map(s => {
              const currentAtt = attendance.find(a => a.studentId === s.id && a.date === new Date().toISOString().split('T')[0]);
              const status = currentAtt?.status || 'present';
              return (
                <div key={s.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <img src={s.avatar} alt={s.firstName} className="w-8 h-8 rounded-full object-cover border" />
                    <div>
                      <span className="font-bold text-slate-900">{s.firstName} {s.lastName}</span>
                      <span className="text-slate-400 block text-[10px]">{s.matricule}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {['present', 'late', 'absent'].map(st => (
                      <button
                        key={st}
                        onClick={() => markAttendance(s.id, `${s.firstName} ${s.lastName}`, s.className, st as any)}
                        className={`px-3 py-1 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                          status === st
                            ? st === 'present' ? 'bg-emerald-500 text-white border-emerald-500' : st === 'late' ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-rose-500 text-white border-rose-500'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {st === 'present' ? 'Présent' : st === 'late' ? 'Retard' : 'Absent'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // 4. Devoirs
  if (activeTab === 'devoirs') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Gestion des Devoirs Publiés</h2>
            <p className="text-xs text-slate-500">Créez, modifiez ou consultez les remises de vos élèves</p>
          </div>
          <button
            onClick={onOpenHomeworkModal}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nouveau Devoir</span>
          </button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {homework.map(hw => (
            <div key={hw.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-[10px] font-bold">{hw.className}</span>
                  <span className="text-[10px] text-slate-400">Limite: {hw.dueDate}</span>
                </div>
                <h3 className="font-bold text-sm text-slate-900 mt-2">{hw.title}</h3>
                <p className="text-xs text-slate-600 mt-1 line-clamp-2">{hw.description}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => setViewSubmissionsHw(hw)}
                  className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Voir remises ({hw.hasSubmission ? '12/35' : '0/35'})</span>
                </button>
                <button
                  onClick={() => setDeleteHwId(hw.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                  title="Supprimer le devoir"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {deleteHwId && (
          <Modal
            isOpen={!!deleteHwId}
            onClose={() => setDeleteHwId(null)}
            title="Confirmer la suppression"
          >
            <div className="space-y-4">
              <p className="text-xs text-slate-600">Êtes-vous sûr de vouloir supprimer ce devoir ? Cette action est irréversible.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDeleteHwId(null)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">Annuler</button>
                <button onClick={() => { showToast('Devoir supprimé.', 'info'); setDeleteHwId(null); }} className="px-4 py-2 text-xs font-bold bg-rose-600 text-white rounded-xl">Supprimer</button>
              </div>
            </div>
          </Modal>
        )}

        {viewSubmissionsHw && (
          <Modal
            isOpen={!!viewSubmissionsHw}
            onClose={() => setViewSubmissionsHw(null)}
            title={`Remises d'Élèves : ${viewSubmissionsHw.title}`}
          >
            <div className="space-y-3 divide-y divide-slate-100 text-xs">
              <div className="py-2 flex items-center justify-between">
                <span>Marc Kabedi (1re Sec A)</span>
                <span className="font-bold text-emerald-600">Remis (10 Août)</span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span>David Muleba (1re Sec A)</span>
                <span className="font-bold text-amber-600">En attente</span>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // 5. Résultats (Saisie des notes)
  if (activeTab === 'resultats') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Saisie des Notes du 1er Trimestre</h2>
            <p className="text-xs text-slate-500">Mme Clarisse Mbuyi — Mathématiques & Physique-Chimie</p>
          </div>
          <button
            onClick={onOpenGradeModal}
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Saisir une Note</span>
          </button>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="p-3.5">Élève</th>
                  <th className="p-3.5">Matière</th>
                  <th className="p-3.5">Note (sur 20)</th>
                  <th className="p-3.5">Coefficient</th>
                  <th className="p-3.5">Appréciation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {grades.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-bold text-slate-900">{g.studentName}</td>
                    <td className="p-3.5 text-blue-700 font-semibold">{g.subject}</td>
                    <td className="p-3.5 font-extrabold text-blue-700">{g.score}/20</td>
                    <td className="p-3.5 font-mono">{g.coefficient}</td>
                    <td className="p-3.5 text-slate-600 italic">« {g.teacherComment} »</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 6. Emploi du temps
  if (activeTab === 'emploi_du_temps') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Mon Emploi du Temps d'Enseignant</h2>
          <p className="text-xs text-slate-500">Mme Clarisse Mbuyi — Année Scolaire 2026–2027</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6">
          <div className="divide-y divide-slate-100">
            {MOCK_TIMETABLE.filter(t => t.teacherName === 'Mme. Clarisse Mbuyi').map(slot => (
              <div key={slot.id} className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 text-blue-700 font-bold rounded-2xl text-xs text-center">
                    <span>{slot.startTime}</span>
                    <span className="block text-[10px] text-slate-400">à {slot.endTime}</span>
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-900">{slot.subject} ({slot.className})</h4>
                    <p className="text-xs text-slate-500">{slot.dayOfWeek}</p>
                  </div>
                </div>
                <span className="px-3 py-1 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl">📍 {slot.room}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 7. Messages
  if (activeTab === 'messages') {
    return <MessagingModule />;
  }

  // 8. Calendrier
  if (activeTab === 'calendrier') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Calendrier Pédagogique & Conseil de Classe</h2>
          <p className="text-xs text-slate-500">Réunions, épreuves et événements scolaires</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {MOCK_EVENTS.map(evt => (
            <div key={evt.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-start gap-4">
              <div className="p-3 bg-amber-100 text-amber-900 font-extrabold rounded-2xl text-center shrink-0">
                <span className="text-xs uppercase block">{evt.date.split(' ')[1]}</span>
                <span className="text-xl block">{evt.date.split(' ')[0]}</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">{evt.title}</h3>
                <p className="text-xs text-slate-600 mt-1">{evt.description}</p>
                <p className="text-[11px] text-slate-400 mt-2 font-medium">🕒 {evt.time} • 📍 {evt.location}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 9. Documents
  if (activeTab === 'documents') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Supports Pédagogiques & Fichiers</h2>
            <p className="text-xs text-slate-500">Partagez vos cours et devoirs au format PDF avec vos élèves</p>
          </div>
          <button
            onClick={() => setShowDocModal(true)}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter un document</span>
          </button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MOCK_DOCUMENTS.map(doc => (
            <div key={doc.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 font-bold text-[10px] uppercase rounded-full">{doc.category}</span>
                <h3 className="font-bold text-sm text-slate-900 mt-2">{doc.title}</h3>
                <p className="text-[11px] text-slate-400 mt-1">{doc.date} • {doc.size}</p>
              </div>
              <button
                onClick={() => showToast(`Document "${doc.title}" téléchargé !`, 'info')}
                className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                <span>Télécharger</span>
              </button>
            </div>
          ))}
        </div>

        <DocumentModal isOpen={showDocModal} onClose={() => setShowDocModal(false)} />
      </div>
    );
  }

  return null;
};
