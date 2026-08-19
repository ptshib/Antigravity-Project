import React, { useState } from 'react';
import { StatCard } from '../../components/common/StatCard';
import { Badge } from '../../components/common/Badge';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import {
  GraduationCap,
  Users,
  UserCheck,
  CalendarCheck,
  CreditCard,
  Megaphone,
  Plus,
  Search,
  Download,
  Calendar,
  Settings
} from 'lucide-react';
import {
  MOCK_STUDENTS,
  MOCK_TEACHERS,
  MOCK_PARENTS,
  MOCK_CLASSES,
  MOCK_PAYMENTS,
  MOCK_DOCUMENTS,
  MOCK_EVENTS,
  MOCK_TIMETABLE,
  MOCK_SETTINGS
} from '../../data/mockData';
import { DocumentModal } from '../../components/modals/DocumentModal';
import { Modal } from '../../components/common/Modal';

interface AdminDashboardProps {
  activeTab: string;
  onOpenAnnouncementModal: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  activeTab,
  onOpenAnnouncementModal
}) => {
  const { announcements, attendance, grades } = useDemo();
  const { showToast } = useNotifications();
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddDocModal, setShowAddDocModal] = useState(false);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<any>(null);
  const [selectedClassDetail, setSelectedClassDetail] = useState<any>(null);
  const [settingsForm, setSettingsForm] = useState(MOCK_SETTINGS);

  // 1. Dashboard Overview
  if (activeTab === 'dashboard') {
    return (
      <div className="space-y-8 animate-fade-in">
        {/* Top Metric Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard title="Total Élèves" value="485" subtitle="Inscrits 2026-2027" icon={<GraduationCap className="w-6 h-6" />} colorScheme="blue" trend={{ value: '+4.2%', isPositive: true }} />
          <StatCard title="Corps Enseignant" value="32" subtitle="Professeurs actifs" icon={<UserCheck className="w-6 h-6" />} colorScheme="emerald" />
          <StatCard title="Parents Connectés" value="360" subtitle="Taux d'accès 94%" icon={<Users className="w-6 h-6" />} colorScheme="amber" />
          <StatCard title="Taux de Présence Jour" value="96.7%" subtitle="Règle: Retard = Présence (29/30 j)" icon={<CalendarCheck className="w-6 h-6" />} colorScheme="purple" trend={{ value: '+1.1%', isPositive: true }} />
        </div>

        {/* Financial & Class Summary Banner */}
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-3xl p-6 shadow-lg border border-slate-700 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-amber-400">Recouvrement des Frais Scolaires</p>
                <h3 className="text-3xl font-extrabold mt-1">$124,500 <span className="text-xs font-normal text-slate-400">perçus sur $142,700</span></h3>
              </div>
              <div className="p-3 bg-amber-500/20 rounded-2xl border border-amber-500/30 text-amber-400">
                <CreditCard className="w-8 h-8" />
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <div className="flex justify-between text-xs font-semibold text-slate-300">
                <span>Objectif Trimestre 1 (87% Réalisé)</span>
                <span>$18,200 Restants</span>
              </div>
              <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 w-[87%] rounded-full"></div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-slate-900 text-base">Actions Rapides Admin</h4>
                <span className="p-2 bg-blue-50 text-blue-600 rounded-xl"><Settings className="w-5 h-5" /></span>
              </div>
              <div className="space-y-2">
                <button
                  onClick={onOpenAnnouncementModal}
                  className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Publier une Annonce Officielle</span>
                </button>
                <button
                  onClick={() => showToast('Rapport de présence de l’école généré (PDF)', 'success')}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Exporter le Rapport de Présence</span>
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 text-center mt-4">PaTShi-Digital Admin Console</p>
          </div>
        </div>

        {/* Recent Announcements & Events */}
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-blue-600" />
                <span>Annonces Recentes</span>
              </h3>
              <button onClick={onOpenAnnouncementModal} className="text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer">+ Nouvelle</button>
            </div>

            <div className="space-y-3">
              {announcements.slice(0, 3).map(ann => (
                <div key={ann.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-slate-900">{ann.title}</h4>
                    <Badge status={ann.priority} />
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">{ann.content}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>Par: {ann.authorName} ({ann.authorRole})</span>
                    <span>{ann.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Calendar className="w-5 h-5 text-amber-500" />
                <span>Prochains Événements Scolaires</span>
              </h3>
            </div>

            <div className="space-y-3">
              {MOCK_EVENTS.map(evt => (
                <div key={evt.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex items-start gap-4">
                  <div className="p-3 bg-amber-100 text-amber-800 rounded-2xl text-center shrink-0 font-bold">
                    <span className="text-xs uppercase block">{evt.date.split(' ')[1]}</span>
                    <span className="text-lg block font-extrabold">{evt.date.split(' ')[0]}</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-sm text-slate-900">{evt.title}</h4>
                    <p className="text-xs text-slate-500 mt-1">{evt.description}</p>
                    <div className="flex items-center gap-4 text-[11px] text-slate-400 mt-2 font-medium">
                      <span>🕒 {evt.time}</span>
                      <span>📍 {evt.location}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Élèves
  if (activeTab === 'eleves') {
    const filteredStudents = MOCK_STUDENTS.filter(s =>
      `${s.firstName} ${s.lastName} ${s.matricule}`.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Répertoire des Élèves ({MOCK_STUDENTS.length})</h2>
            <p className="text-xs text-slate-500">Gestion des dossiers élèves et inscriptions 2026–2027</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Rechercher nom ou matricule..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-b border-slate-200 uppercase tracking-wider">
                  <th className="p-4">Élève</th>
                  <th className="p-4">Matricule</th>
                  <th className="p-4">Classe</th>
                  <th className="p-4">Sexe</th>
                  <th className="p-4">Moyenne</th>
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredStudents.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 flex items-center gap-3">
                      <img src={s.avatar} alt={s.firstName} className="w-8 h-8 rounded-full object-cover border" />
                      <span className="font-bold text-slate-900">{s.firstName} {s.lastName}</span>
                    </td>
                    <td className="p-4 font-mono text-slate-600">{s.matricule}</td>
                    <td className="p-4 font-semibold text-blue-700">{s.className}</td>
                    <td className="p-4">{s.gender}</td>
                    <td className="p-4 font-bold text-emerald-600">{s.overallAverage ? `${s.overallAverage}%` : 'N/A'}</td>
                    <td className="p-4 flex items-center gap-2">
                      <button
                        onClick={() => setSelectedStudentDetail(s)}
                        className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-lg cursor-pointer"
                      >
                        Consulter dossier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {selectedStudentDetail && (
          <Modal
            isOpen={!!selectedStudentDetail}
            onClose={() => setSelectedStudentDetail(null)}
            title={`Dossier Élève : ${selectedStudentDetail.firstName} ${selectedStudentDetail.lastName}`}
          >
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <img src={selectedStudentDetail.avatar} alt={selectedStudentDetail.firstName} className="w-12 h-12 rounded-full object-cover border" />
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{selectedStudentDetail.firstName} {selectedStudentDetail.lastName}</h4>
                  <p className="text-slate-500 font-mono">{selectedStudentDetail.matricule} • {selectedStudentDetail.className}</p>
                </div>
              </div>
              <p><strong>Date de naissance :</strong> {selectedStudentDetail.dateOfBirth}</p>
              <p><strong>Genre :</strong> {selectedStudentDetail.gender === 'M' ? 'Masculin' : 'Féminin'}</p>
              <p><strong>Moyenne actuelle :</strong> <strong className="text-emerald-600">{selectedStudentDetail.overallAverage}%</strong></p>
              <p><strong>Statut du compte :</strong> <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-full">Actif</span></p>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // 3. Parents
  if (activeTab === 'parents') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Répertoire des Parents d’Élèves</h2>
            <p className="text-xs text-slate-500">Coordonnées et enfants rattachés</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {MOCK_PARENTS.map(p => (
            <div key={p.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center text-sm">
                  {p.firstName[0]}{p.lastName[0]}
                </div>
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{p.firstName} {p.lastName}</h4>
                  <p className="text-xs text-slate-500">{p.email}</p>
                </div>
              </div>
              <div className="text-xs text-slate-600 space-y-1">
                <p>📞 {p.phone}</p>
                <p>📍 {p.address}</p>
              </div>
              <div className="pt-3 border-t border-slate-100">
                <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">Enfants rattachés ({p.children.length})</p>
                <div className="flex flex-wrap gap-2">
                  {p.children.map(ch => (
                    <span key={ch.id} className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
                      {ch.firstName} ({ch.className})
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4. Enseignants
  if (activeTab === 'enseignants') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Corps Enseignant & Titulaires</h2>
          <p className="text-xs text-slate-500">Liste des professeurs et matières enseignées</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {MOCK_TEACHERS.map(t => (
            <div key={t.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center gap-3">
                <img src={t.avatar} alt={t.firstName} className="w-12 h-12 rounded-full object-cover border" />
                <div>
                  <h4 className="font-bold text-base text-slate-900">{t.firstName} {t.lastName}</h4>
                  <p className="text-xs text-slate-500">{t.email} • {t.phone}</p>
                </div>
              </div>
              <div className="space-y-2 text-xs">
                <p><strong>Matières :</strong> {t.subjects.join(', ')}</p>
                <p><strong>Classes :</strong> {t.classes.join(', ')}</p>
              </div>
              <button
                onClick={() => showToast(`Profil enseignant de ${t.firstName} consulté`, 'info')}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl cursor-pointer"
              >
                Gérer les affectations
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 5. Classes
  if (activeTab === 'classes') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Classes & Salles de Cours</h2>
          <p className="text-xs text-slate-500">Répartition des effectifs pour l’année 2026–2027</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {MOCK_CLASSES.map(cls => (
            <div key={cls.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold text-base text-slate-900">{cls.name}</h3>
                <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-bold rounded-full">{cls.level}</span>
              </div>
              <p className="text-xs text-slate-600">Prof. Titulaire : <strong>{cls.mainTeacherName}</strong></p>
              <p className="text-xs text-slate-500">📍 {cls.room} • Effectif : <strong>{cls.studentCount} élèves</strong></p>
              <button
                onClick={() => setSelectedClassDetail(cls)}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl cursor-pointer"
              >
                Voir les élèves de la classe
              </button>
            </div>
          ))}
        </div>

        {selectedClassDetail && (
          <Modal
            isOpen={!!selectedClassDetail}
            onClose={() => setSelectedClassDetail(null)}
            title={`Élèves de la classe : ${selectedClassDetail.name}`}
          >
            <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto text-xs">
              {MOCK_STUDENTS.filter(s => s.className === selectedClassDetail.name).map(s => (
                <div key={s.id} className="py-2 flex items-center justify-between">
                  <span>{s.firstName} {s.lastName}</span>
                  <span className="font-mono text-slate-400">{s.matricule}</span>
                </div>
              ))}
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // 6. Communications
  if (activeTab === 'communications') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Centre de Communication & Annonces</h2>
            <p className="text-xs text-slate-500">Diffusion des communiqués officiels de l'établissement</p>
          </div>
          <button
            onClick={onOpenAnnouncementModal}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Publier une Annonce</span>
          </button>
        </div>

        <div className="space-y-4">
          {announcements.map(ann => (
            <div key={ann.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <Badge status={ann.priority} />
                <span className="text-xs text-slate-400">{ann.date}</span>
              </div>
              <h3 className="font-bold text-base text-slate-900">{ann.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{ann.content}</p>
              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                Auteur : {ann.authorName} ({ann.authorRole})
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 7. Présences
  if (activeTab === 'presences') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Registre Global des Présences</h2>
            <p className="text-xs text-slate-500">Statistiques de présence et suivi des retards/absences</p>
          </div>
          <button
            onClick={() => showToast('Rapport des présences exporté en PDF', 'success')}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Exporter le Rapport</span>
          </button>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="p-3.5">Élève</th>
                  <th className="p-3.5">Classe</th>
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5">Statut</th>
                  <th className="p-3.5">Motif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {attendance.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-bold text-slate-900">{a.studentName}</td>
                    <td className="p-3.5 text-blue-700 font-semibold">{a.className}</td>
                    <td className="p-3.5">{a.date}</td>
                    <td className="p-3.5"><Badge status={a.status} /></td>
                    <td className="p-3.5 text-slate-600">{a.justification || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 8. Résultats
  if (activeTab === 'resultats') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Résultats & Moyennes Scolaires</h2>
          <p className="text-xs text-slate-500">Synthèse générale du 1er Trimestre</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase border-b border-slate-200">
                  <th className="p-3.5">Élève</th>
                  <th className="p-3.5">Matière</th>
                  <th className="p-3.5">Note (sur 20)</th>
                  <th className="p-3.5">Appréciation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {grades.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="p-3.5 font-bold text-slate-900">{g.studentName}</td>
                    <td className="p-3.5 text-blue-700 font-semibold">{g.subject}</td>
                    <td className="p-3.5 font-extrabold text-blue-700">{g.score}/20</td>
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

  // 9. Emplois du temps
  if (activeTab === 'emplois_du_temps') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Emplois du Temps Officiels (Master)</h2>
          <p className="text-xs text-slate-500">Vérification automatique de non-chevauchement des cours et des salles</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6">
          <div className="divide-y divide-slate-100">
            {MOCK_TIMETABLE.map(slot => (
              <div key={slot.id} className="py-3.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-extrabold text-blue-700">{slot.subject}</span>
                  <span className="text-slate-500 font-medium block">{slot.className} • {slot.teacherName}</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-slate-900">{slot.dayOfWeek} ({slot.startTime} - {slot.endTime})</span>
                  <span className="text-slate-400 block text-[10px]">📍 {slot.room}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 10. Frais scolaires
  if (activeTab === 'frais_scolaires') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Comptabilité & Frais Scolaires</h2>
            <p className="text-xs text-slate-500">Registre général des encaissements et impayés</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-b border-slate-200 uppercase tracking-wider">
                  <th className="p-4">Élève</th>
                  <th className="p-4">Classe</th>
                  <th className="p-4">Motif</th>
                  <th className="p-4">Montant</th>
                  <th className="p-4">Statut</th>
                  <th className="p-4">N° Reçu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {MOCK_PAYMENTS.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-bold text-slate-900">{p.studentName}</td>
                    <td className="p-4">{p.className}</td>
                    <td className="p-4 text-slate-600">{p.description}</td>
                    <td className="p-4 font-extrabold text-slate-900">{p.currency}{p.amount}</td>
                    <td className="p-4"><Badge status={p.status} /></td>
                    <td className="p-4 font-mono text-slate-500">{p.receiptNumber || 'En attente'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 11. Calendrier
  if (activeTab === 'calendrier') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Calendrier Général de l’Établissement</h2>
          <p className="text-xs text-slate-500">Gestion des épreuves, vacances et événements officiels</p>
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

  // 12. Documents
  if (activeTab === 'documents') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Bibliothèque de Documents Administratifs</h2>
            <p className="text-xs text-slate-500">Archives et formulaires officiels</p>
          </div>
          <button
            onClick={() => setShowAddDocModal(true)}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter un document</span>
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
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

        <DocumentModal isOpen={showAddDocModal} onClose={() => setShowAddDocModal(false)} />
      </div>
    );
  }

  // 13. Paramètres
  if (activeTab === 'parametres') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Paramètres de l’Établissement</h2>
          <p className="text-xs text-slate-500">Configuration générale d’ÉcoleConnect pour votre école</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Nom de l'établissement</label>
              <input
                type="text"
                value={settingsForm.schoolName}
                onChange={e => setSettingsForm({ ...settingsForm, schoolName: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Année Scolaire Active</label>
              <input
                type="text"
                value={settingsForm.academicYear}
                onChange={e => setSettingsForm({ ...settingsForm, academicYear: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Téléphone de l'école</label>
              <input
                type="text"
                value={settingsForm.phone}
                onChange={e => setSettingsForm({ ...settingsForm, phone: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">WhatsApp Officiel</label>
              <input
                type="text"
                value={settingsForm.whatsapp}
                onChange={e => setSettingsForm({ ...settingsForm, whatsapp: e.target.value })}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              onClick={() => showToast('Paramètres de l’établissement enregistrés avec succès !', 'success')}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Sauvegarder les paramètres
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
