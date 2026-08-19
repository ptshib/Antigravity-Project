import React, { useState } from 'react';
import { StatCard } from '../../components/common/StatCard';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import {
  BookOpen,
  Award,
  Clock,
  CalendarCheck,
  Download,
  Search,
  UploadCloud
} from 'lucide-react';
import { MOCK_TIMETABLE, MOCK_DOCUMENTS, MOCK_COURSES, MOCK_EVENTS, DEMO_USERS } from '../../data/mockData';
import { MessagingModule } from '../../components/messaging/MessagingModule';
import { Modal } from '../../components/common/Modal';

interface StudentDashboardProps {
  activeTab: string;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ activeTab }) => {
  const { homework, grades } = useDemo();
  const { showToast } = useNotifications();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHwModal, setSelectedHwModal] = useState<any>(null);
  const [submissionFile, setSubmissionFile] = useState('');

  const studentAvatar = user?.avatar || DEMO_USERS.student.avatar;

  const handleSubmitHomework = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedHwModal) {
      showToast(`Devoir "${selectedHwModal.title}" soumis avec succès !`, 'success');
      setSelectedHwModal(null);
      setSubmissionFile('');
    }
  };

  // 1. Dashboard Overview / Mes cours
  if (activeTab === 'dashboard' || activeTab === 'mes_cours') {
    return (
      <div className="space-y-8 animate-fade-in">
        {/* Welcome Student Banner */}
        <div className="bg-gradient-to-r from-blue-900 via-sky-900 to-slate-900 rounded-3xl p-6 text-white shadow-lg border border-blue-800 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img
              src={studentAvatar}
              alt="Marc Kabedi"
              className="w-16 h-16 rounded-2xl object-cover border-2 border-amber-400 shadow-md"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-extrabold">{user?.name || 'Marc Kabedi'}</h2>
                <span className="px-3 py-1 rounded-full bg-blue-500/30 text-blue-200 border border-blue-400/30 font-bold text-xs">
                  1re Secondaire A
                </span>
              </div>
              <p className="text-xs text-blue-200 mt-1">
                Année Scolaire 2026–2027 | Complexe Scolaire Les Horizons
              </p>
            </div>
          </div>

          <div className="bg-white/10 px-5 py-3 rounded-2xl border border-white/20 text-center">
            <p className="text-[11px] uppercase tracking-wider text-amber-300 font-extrabold">Moyenne Générale</p>
            <p className="text-3xl font-black text-white mt-0.5">84.5%</p>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard title="Cours du jour" value="4 Cours" subtitle="Math, Français, Physique, Info" icon={<Clock className="w-6 h-6" />} colorScheme="blue" />
          <StatCard title="Devoirs à Rendre" value={homework.length} subtitle="Prochaine limite 15 Août" icon={<BookOpen className="w-6 h-6" />} colorScheme="amber" />
          <StatCard title="Dernière Note" value="17.5/20" subtitle="Mathématiques" icon={<Award className="w-6 h-6" />} colorScheme="emerald" />
          <StatCard title="Présences Trimestre" value="96.7%" subtitle="29/30 jours comptabilisés" icon={<CalendarCheck className="w-6 h-6" />} colorScheme="purple" />
        </div>

        {/* Mes Cours List */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base pb-3 border-b border-slate-100">
            Mes Matières et Progression (1er Trimestre)
          </h3>

          <div className="grid md:grid-cols-2 gap-4">
            {MOCK_COURSES.map(course => (
              <div key={course.id} className="p-5 rounded-2xl bg-slate-50 border border-slate-100 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-blue-700 font-bold">{course.code}</span>
                    <span className="text-xs font-extrabold text-emerald-600">{course.progress}% complété</span>
                  </div>
                  <h4 className="font-extrabold text-base text-slate-900 mt-1">{course.name}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Enseignant : {course.teacherName}</p>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-200/60">
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full" style={{ width: `${course.progress}%` }}></div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>🕒 Prochain cours: {course.nextClass}</span>
                    <span className="font-semibold text-blue-600">{course.documentCount} supports PDF</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 2. Devoirs
  if (activeTab === 'devoirs') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Mes Devoirs à Rendre</h2>
          <p className="text-xs text-slate-500">Consultez et soumettez vos travaux scolaires pour la classe de 1re Secondaire A</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {homework.map(hw => (
            <div key={hw.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-xs font-bold">{hw.subject}</span>
                  <span className="text-xs font-bold text-rose-600">À rendre le {hw.dueDate}</span>
                </div>
                <h3 className="font-bold text-base text-slate-900 mt-2">{hw.title}</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{hw.description}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Enseignant : {hw.teacherName}</span>
                <button
                  onClick={() => setSelectedHwModal(hw)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-colors"
                >
                  Remettre le devoir
                </button>
              </div>
            </div>
          ))}
        </div>

        {selectedHwModal && (
          <Modal
            isOpen={!!selectedHwModal}
            onClose={() => setSelectedHwModal(null)}
            title={`Soumettre le devoir : ${selectedHwModal.title}`}
          >
            <form onSubmit={handleSubmitHomework} className="space-y-4">
              <p className="text-xs text-slate-600"><strong>Matière :</strong> {selectedHwModal.subject} | <strong>Limite :</strong> {selectedHwModal.dueDate}</p>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Sélectionner votre fichier de travail</label>
                <div className="p-4 border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-2xl bg-slate-50 text-center cursor-pointer relative">
                  <UploadCloud className="w-8 h-8 text-blue-500 mx-auto mb-1" />
                  <p className="text-xs font-semibold text-slate-700">Cliquez pour téléverser votre fichier (PDF, DOCX, ZIP)</p>
                  <input
                    type="file"
                    onChange={e => setSubmissionFile(e.target.files?.[0]?.name || '')}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
                {submissionFile && (
                  <p className="text-xs font-bold text-emerald-600 mt-2">Fichier à envoyer : {submissionFile}</p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedHwModal(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-xs"
                >
                  Confirmer la remise
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    );
  }

  // 3. Résultats
  if (activeTab === 'resultats') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Mes Résultats & Carnet de Notes</h2>
            <p className="text-xs text-slate-500">Moyenne Générale : <strong className="text-emerald-600 font-extrabold">84.5%</strong> (16.9/20)</p>
          </div>
          <button
            onClick={() => showToast('Relevé de notes Marc Kabedi téléchargé !', 'success')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
          >
            <Download className="w-4 h-4" />
            <span>Télécharger Relevé</span>
          </button>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base pb-3 border-b border-slate-100">Notes du 1er Trimestre (sur 20)</h3>
          <div className="divide-y divide-slate-100">
            {grades.filter(g => g.studentId === 'stud_1').map(g => (
              <div key={g.id} className="py-4 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{g.subject}</h4>
                  <p className="text-[11px] text-slate-400">Coeff. {g.coefficient} • {g.date}</p>
                  <p className="text-xs text-slate-600 italic mt-1">« {g.teacherComment} »</p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-extrabold text-blue-700">{g.score}</span>
                  <span className="text-xs font-bold text-slate-400">/{g.maxScore}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 4. Emploi du temps
  if (activeTab === 'emploi_du_temps') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Mon Emploi du Temps — 1re Secondaire A</h2>
          <p className="text-xs text-slate-500">Horaires des cours et salles (Année Scolaire 2026–2027)</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6">
          <div className="divide-y divide-slate-100">
            {MOCK_TIMETABLE.filter(t => t.className === '1re Secondaire A').map(slot => (
              <div key={slot.id} className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 text-blue-700 font-bold rounded-2xl text-xs text-center">
                    <span>{slot.startTime}</span>
                    <span className="block text-[10px] text-slate-400">à {slot.endTime}</span>
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-900">{slot.subject}</h4>
                    <p className="text-xs text-slate-500">{slot.teacherName} • {slot.dayOfWeek}</p>
                  </div>
                </div>
                <span className="px-3 py-1 bg-slate-100 text-slate-700 font-bold text-xs rounded-xl">
                  📍 {slot.room}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 5. Messages
  if (activeTab === 'messages') {
    return <MessagingModule />;
  }

  // 6. Calendrier
  if (activeTab === 'calendrier') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Mon Calendrier Scolaire</h2>
          <p className="text-xs text-slate-500">Dates des contrôles, examens et activités</p>
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

  // 7. Documents
  if (activeTab === 'documents') {
    const filteredDocs = MOCK_DOCUMENTS.filter(d => d.title.toLowerCase().includes(searchTerm.toLowerCase()));
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Documents & Cours Partagés</h2>
            <p className="text-xs text-slate-500">Téléchargez vos supports de cours et règlements</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocs.map(doc => (
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
      </div>
    );
  }

  return null;
};
