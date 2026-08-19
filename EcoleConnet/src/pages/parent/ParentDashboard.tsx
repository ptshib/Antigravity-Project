import React, { useState } from 'react';
import { StatCard } from '../../components/common/StatCard';
import { Badge } from '../../components/common/Badge';
import { useDemo } from '../../context/DemoContext';
import { useNotifications } from '../../context/NotificationContext';
import {
  CalendarCheck,
  Phone,
  Download,
  Search,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send
} from 'lucide-react';
import {
  DEMO_CHILDREN,
  MOCK_PAYMENTS,
  MOCK_TIMETABLE,
  MOCK_DOCUMENTS,
  MOCK_EVENTS,
  SCHOOL_INFO
} from '../../data/mockData';
import { JustificationModal } from '../../components/modals/JustificationModal';
import { MessagingModule } from '../../components/messaging/MessagingModule';
import { Modal } from '../../components/common/Modal';
import { calculateAttendanceStats } from '../../utils/attendanceUtils';

interface ParentDashboardProps {
  activeTab: string;
  onOpenMessaging?: () => void;
}

export const ParentDashboard: React.FC<ParentDashboardProps> = ({ activeTab }) => {
  const { activeChildIndex, setActiveChildIndex, activeChild, grades, attendance, homework } = useDemo();
  const { showToast } = useNotifications();

  // Filters & State
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showJustifyModal, setShowJustifyModal] = useState(false);
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState<any>(null);
  const [selectedEventDetail, setSelectedEventDetail] = useState<any>(null);

  const childGrades = grades.filter(g => g.studentId === activeChild.id);
  const childAttendance = attendance.filter(a => a.studentId === activeChild.id);
  const attStats = calculateAttendanceStats(childAttendance);
  const childPayments = MOCK_PAYMENTS.filter(p => p.studentId === activeChild.id);
  const childTimetable = MOCK_TIMETABLE.filter(t => t.className === activeChild.className);

  const whatsappUrl = `https://wa.me/${SCHOOL_INFO.whatsapp.replace(/[^0-9]/g, '')}?text=Bonjour%20la%20Direction,%20je%20suis%20Mme%20Marie%20Kabedi,%20parent%20de%20${activeChild.firstName}%20Kabedi.`;

  // 1. Dashboard Overview / Mes Enfants
  if (activeTab === 'dashboard' || activeTab === 'mes_enfants') {
    return (
      <div className="space-y-8 animate-fade-in">
        {/* Child Selector Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 rounded-3xl p-6 text-white shadow-lg border border-slate-700 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <img
              src={activeChild.avatar}
              alt={activeChild.firstName}
              className="w-16 h-16 rounded-2xl object-cover border-2 border-amber-400 shadow-md"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-extrabold">{activeChild.firstName} {activeChild.lastName}</h2>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 font-bold text-[10px]">
                  {activeChild.className}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Matricule: <span className="font-mono text-amber-400">{activeChild.matricule}</span> | Moyenne générale:{' '}
                <strong className="text-emerald-400">{activeChild.overallAverage}%</strong>
              </p>
            </div>
          </div>

          {/* Child Toggle Pill */}
          <div className="bg-slate-950/80 p-1.5 rounded-2xl border border-slate-700 flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 px-2 hidden sm:inline">Mes Enfants:</span>
            {DEMO_CHILDREN.map((child, idx) => (
              <button
                key={child.id}
                onClick={() => setActiveChildIndex(idx)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  activeChildIndex === idx
                    ? 'bg-amber-500 text-slate-950 shadow-md scale-105'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span>{child.firstName}</span>
                <span className="text-[10px] opacity-80">({child.className.split(' ')[0]})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Children Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {DEMO_CHILDREN.map((ch, idx) => {
            const isSelected = activeChildIndex === idx;
            return (
              <div
                key={ch.id}
                className={`bg-white rounded-3xl p-6 border shadow-xs transition-all flex flex-col justify-between ${
                  isSelected ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={ch.avatar} alt={ch.firstName} className="w-12 h-12 rounded-2xl object-cover border" />
                      <div>
                        <h3 className="font-extrabold text-base text-slate-900">{ch.firstName} {ch.lastName}</h3>
                        <p className="text-xs text-slate-500">{ch.className} • {ch.matricule}</p>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                        Enfant sélectionné
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Moyenne</p>
                      <p className="text-sm font-extrabold text-blue-700">{ch.overallAverage}%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Présence</p>
                      <p className="text-sm font-extrabold text-emerald-600">98%</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Frais</p>
                      <p className="text-sm font-extrabold text-amber-600">À jour</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setActiveChildIndex(idx)}
                  className={`mt-4 w-full py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                  }`}
                >
                  Voir le profil scolaire de {ch.firstName}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 2. Présences
  if (activeTab === 'presences') {
    const filteredAttendance = childAttendance.filter(a => {
      if (selectedStatusFilter !== 'all' && a.status !== selectedStatusFilter) return false;
      return true;
    });

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Suivi des Présences — {activeChild.firstName} Kabedi</h2>
            <p className="text-xs text-slate-500">Classe de {activeChild.className} | Registre du 1er Trimestre</p>
          </div>
          <button
            onClick={() => setShowJustifyModal(true)}
            className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>Envoyer un justificatif d’absence</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid sm:grid-cols-4 gap-4">
          <StatCard title="Statut Aujourd'hui" value="Présent(e)" subtitle="Arrivé à 07h45" icon={<CheckCircle2 className="w-5 h-5" />} colorScheme="emerald" />
          <StatCard title="Taux de Présence" value={attStats.attendanceRateFormatted} subtitle="29/30 jours comptabilisés" icon={<CalendarCheck className="w-5 h-5" />} colorScheme="blue" />
          <StatCard title="Total Présences" value={`${attStats.countedPresentDays} Jours`} subtitle={`Sur ${attStats.totalSchoolDays} jours de cours`} icon={<Clock className="w-5 h-5" />} colorScheme="purple" />
          <StatCard title="Absences / Retards" value={`${attStats.absentDays + attStats.lateDays}`} subtitle={`${attStats.lateDays} Retard, ${attStats.absentDays} Absence`} icon={<AlertCircle className="w-5 h-5" />} colorScheme="amber" />
        </div>

        {/* Attendance Log Table & Filters */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900 text-base">Historique des Présences</h3>
            <div className="flex items-center gap-2">
              <select
                value={selectedStatusFilter}
                onChange={e => setSelectedStatusFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none"
              >
                <option value="all">Tous les statuts</option>
                <option value="present">Présent(e)</option>
                <option value="late">En retard</option>
                <option value="absent">Absent(e)</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5">Élève</th>
                  <th className="p-3.5">Classe</th>
                  <th className="p-3.5">Statut</th>
                  <th className="p-3.5">Motif / Justification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredAttendance.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">Aucun enregistrement ne correspond aux filtres sélectionnées.</td>
                  </tr>
                ) : (
                  filteredAttendance.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-bold text-slate-900">{a.date}</td>
                      <td className="p-3.5">{a.studentName}</td>
                      <td className="p-3.5 text-blue-700 font-semibold">{a.className}</td>
                      <td className="p-3.5"><Badge status={a.status} /></td>
                      <td className="p-3.5 text-slate-600">{a.justification || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <JustificationModal
          isOpen={showJustifyModal}
          onClose={() => setShowJustifyModal(false)}
          studentName={`${activeChild.firstName} ${activeChild.lastName}`}
        />
      </div>
    );
  }

  // 3. Résultats
  if (activeTab === 'resultats') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Carnet de Notes & Bulletin — {activeChild.firstName}</h2>
            <p className="text-xs text-slate-500">Moyenne Générale : <strong className="text-emerald-600">{activeChild.overallAverage}%</strong> (16.9/20)</p>
          </div>
          <button
            onClick={() => showToast(`Bulletin Officiel 1er Trimestre (${activeChild.firstName} Kabedi) généré !`, 'success')}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Télécharger le Bulletin (PDF)</span>
          </button>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base pb-3 border-b border-slate-100">Notes par Matière (sur 20)</h3>
          <div className="divide-y divide-slate-100">
            {childGrades.map(g => (
              <div key={g.id} className="py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900">{g.subject}</h4>
                    <p className="text-[11px] text-slate-400">Coeff. {g.coefficient} • Évaluation du {g.date}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-blue-700">{g.score}</span>
                    <span className="text-xs font-bold text-slate-400">/{g.maxScore}</span>
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 italic">
                  « {g.teacherComment} »
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 4. Devoirs
  if (activeTab === 'devoirs') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Cahier de Textes & Devoirs — {activeChild.firstName}</h2>
          <p className="text-xs text-slate-500">Consultez les devoirs à faire et les travaux soumis.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {homework.map(hw => (
            <div key={hw.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">{hw.subject}</span>
                <span className="text-xs font-bold text-rose-600">Limite: {hw.dueDate}</span>
              </div>
              <h3 className="font-bold text-base text-slate-900">{hw.title}</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{hw.description}</p>
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Enseignant: {hw.teacherName}</span>
                <span className="text-emerald-600 font-bold">Actif</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 5. Emploi du temps
  if (activeTab === 'emploi_du_temps') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
          <h2 className="text-2xl font-bold text-slate-900">Emploi du Temps Hebdomadaire — {activeChild.className}</h2>
          <p className="text-xs text-slate-500">Horaires officiels de cours de {activeChild.firstName} (2026–2027)</p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6">
          <div className="grid divide-y divide-slate-100">
            {childTimetable.map(slot => (
              <div key={slot.id} className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 text-blue-700 font-bold rounded-2xl text-xs text-center shrink-0">
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

  // 6. Paiements
  if (activeTab === 'paiements') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Comptabilité & Frais Scolaires — {activeChild.firstName}</h2>
            <p className="text-xs text-slate-500">Historique des règlements et échéances à venir</p>
          </div>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2"
          >
            <Phone className="w-4 h-4" />
            <span>Contacter la Comptabilité WhatsApp</span>
          </a>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {childPayments.map(p => (
            <div key={p.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <Badge status={p.status} />
                  <span className="font-mono text-xs text-slate-400">{p.receiptNumber || 'En attente'}</span>
                </div>
                <h3 className="font-bold text-base text-slate-900 mt-2">{p.description}</h3>
                <p className="text-xl font-extrabold text-blue-700 mt-1">{p.currency}{p.amount}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2">
                <button
                  onClick={() => setSelectedPaymentDetail(p)}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Voir le détail
                </button>
                {p.receiptNumber && (
                  <button
                    onClick={() => showToast(`Reçu N° ${p.receiptNumber} téléchargé !`, 'success')}
                    className="w-full py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-xl cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Télécharger le Reçu</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {selectedPaymentDetail && (
          <Modal
            isOpen={!!selectedPaymentDetail}
            onClose={() => setSelectedPaymentDetail(null)}
            title="Détail du Règlement Scolaire"
          >
            <div className="space-y-3 text-xs">
              <p><strong>Élève :</strong> {selectedPaymentDetail.studentName} ({selectedPaymentDetail.className})</p>
              <p><strong>Libellé :</strong> {selectedPaymentDetail.description}</p>
              <p><strong>Montant :</strong> {selectedPaymentDetail.currency}{selectedPaymentDetail.amount}</p>
              <p><strong>Statut :</strong> {selectedPaymentDetail.status.toUpperCase()}</p>
              <p><strong>Échéance :</strong> {selectedPaymentDetail.dueDate}</p>
              {selectedPaymentDetail.paidDate && <p><strong>Date de paiement :</strong> {selectedPaymentDetail.paidDate}</p>}
              {selectedPaymentDetail.receiptNumber && <p><strong>N° Reçu Officiel :</strong> {selectedPaymentDetail.receiptNumber}</p>}
            </div>
          </Modal>
        )}
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
          <h2 className="text-2xl font-bold text-slate-900">Calendrier des Événements & Examens</h2>
          <p className="text-xs text-slate-500">Année Scolaire 2026–2027 — Complexe Scolaire Les Horizons</p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {MOCK_EVENTS.map(evt => (
            <div
              key={evt.id}
              onClick={() => setSelectedEventDetail(evt)}
              className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs hover:shadow-md transition-shadow cursor-pointer flex items-start gap-4"
            >
              <div className="p-3 bg-amber-100 text-amber-900 font-extrabold rounded-2xl text-center shrink-0">
                <span className="text-xs uppercase block">{evt.date.split(' ')[1]}</span>
                <span className="text-xl block">{evt.date.split(' ')[0]}</span>
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-base text-slate-900">{evt.title}</h3>
                <p className="text-xs text-slate-600 mt-1">{evt.description}</p>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400 font-medium">
                  <span>🕒 {evt.time}</span>
                  <span>📍 {evt.location}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {selectedEventDetail && (
          <Modal
            isOpen={!!selectedEventDetail}
            onClose={() => setSelectedEventDetail(null)}
            title={selectedEventDetail.title}
          >
            <div className="space-y-3 text-xs">
              <p className="text-slate-700 leading-relaxed">{selectedEventDetail.description}</p>
              <p><strong>Date :</strong> {selectedEventDetail.date}</p>
              <p><strong>Horaire :</strong> {selectedEventDetail.time}</p>
              <p><strong>Lieu :</strong> {selectedEventDetail.location}</p>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // 9. Documents
  if (activeTab === 'documents') {
    const filteredDocs = MOCK_DOCUMENTS.filter(d =>
      d.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
      <div className="space-y-6 animate-fade-in">
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Documents Administratifs & Circulaires</h2>
            <p className="text-xs text-slate-500">Téléchargez les règlements, reçus et bulletins de {activeChild.firstName}</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Rechercher un document..."
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
                <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 font-bold text-[10px] uppercase rounded-full">
                  {doc.category}
                </span>
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
