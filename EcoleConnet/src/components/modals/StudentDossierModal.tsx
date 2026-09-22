import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  GraduationCap,
  BookOpen,
  Calendar,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Edit3,
  Save,
  Lock,
  ArrowRightLeft,
  Activity,
  FileCheck
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface StudentDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string | null;
  initialMode?: 'view' | 'edit';
  onStudentUpdated?: () => void;
}

export const StudentDossierModal: React.FC<StudentDossierModalProps> = ({
  isOpen,
  onClose,
  studentId,
  initialMode = 'view',
  onStudentUpdated
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [activeTab, setActiveTab] = useState<'info' | 'enrollment' | 'attendance' | 'finance'>('info');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dossier, setDossier] = useState<any>(null);

  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | ''>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [guardianReference, setGuardianReference] = useState('');
  
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setSuccessMessage(null);
    if (isOpen && studentId) {
      loadDossier();
    }
  }, [isOpen, studentId, initialMode]);

  const loadDossier = async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_student_full_dossier', {
        p_student_id: studentId
      });

      if (rpcErr) {
        throw rpcErr;
      }

      setDossier(data);
      if (data?.student) {
        setFirstName(data.student.first_name || '');
        setLastName(data.student.last_name || '');
        setMiddleName(data.student.middle_name || '');
        setGender(data.student.gender || '');
        setDateOfBirth(data.student.date_of_birth || '');
        setBirthPlace(data.student.birth_place || '');
        setGuardianReference(data.student.guardian_reference || '');
      }
    } catch (err: any) {
      console.error('Erreur chargement dossier élève:', err);
      setError(err.message || 'Impossible de charger le dossier de l’élève.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError('Le prénom et le nom sont obligatoires.');
      return;
    }
    setError(null);
    setShowConfirmModal(true);
  };

  const confirmUpdate = async () => {
    if (!studentId) return;
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const { error: updateErr } = await supabase.rpc('update_student_personal_info', {
        p_student_id: studentId,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_middle_name: middleName.trim() || null,
        p_gender: gender || null,
        p_date_of_birth: dateOfBirth || null,
        p_birth_place: birthPlace.trim() || null,
        p_guardian_reference: guardianReference.trim() || null
      });

      if (updateErr) {
        throw updateErr;
      }

      setSuccessMessage('Les informations de l’élève ont été mises à jour avec succès.');
      setShowConfirmModal(false);
      setMode('view');
      await loadDossier();
      if (onStudentUpdated) {
        onStudentUpdated();
      }
    } catch (err: any) {
      console.error('Erreur mise à jour élève:', err);
      setError(err.message || 'Échec de la mise à jour des informations.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const st = dossier?.student;
  const enrollments = dossier?.enrollment_history || [];
  const attendance = dossier?.attendance_summary || {};
  const academic = dossier?.academic_summary || {};
  const financial = dossier?.financial_summary || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-white">
                  {st ? `${st.first_name} ${st.last_name} ${st.middle_name ? `(${st.middle_name})` : ''}` : 'Fiche de l’Élève'}
                </h2>
                {st?.student_number && (
                  <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-mono text-xs font-bold">
                    {st.student_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {st?.current_class_name ? `Classe actuelle : ${st.current_class_name}` : 'Élève préenregistré'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'view' ? (
              <button
                onClick={() => setMode('edit')}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Edit3 className="w-4 h-4" />
                <span>Modifier</span>
              </button>
            ) : (
              <button
                onClick={() => setMode('view')}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <User className="w-4 h-4" />
                <span>Voir la Fiche</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mx-6 mt-4 p-4 bg-rose-500/10 border border-rose-500/40 rounded-2xl flex items-center gap-3 text-xs text-rose-300">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-2xl flex items-center gap-3 text-xs text-emerald-300">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-bold text-slate-400">Chargement du dossier élève...</p>
            </div>
          ) : mode === 'view' ? (
            <>
              {/* Tabs Navigation */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
                <button
                  onClick={() => setActiveTab('info')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'info'
                      ? 'bg-amber-500 text-slate-950 shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span>Informations Personnelles</span>
                </button>

                <button
                  onClick={() => setActiveTab('enrollment')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'enrollment'
                      ? 'bg-amber-500 text-slate-950 shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>Inscriptions & Classes ({enrollments.length})</span>
                </button>

                <button
                  onClick={() => setActiveTab('attendance')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'attendance'
                      ? 'bg-amber-500 text-slate-950 shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  <span>Présences & Résultats</span>
                </button>

                <button
                  onClick={() => setActiveTab('finance')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'finance'
                      ? 'bg-amber-500 text-slate-950 shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Situation Financière</span>
                </button>
              </div>

              {/* TAB 1: INFORMATIONS PERSONNELLES */}
              {activeTab === 'info' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <User className="w-4 h-4 text-amber-400" />
                      <span>Identité Scolaire</span>
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Matricule</span>
                        <span className="font-mono font-bold text-amber-400">{st?.student_number || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Prénom</span>
                        <span className="font-extrabold text-white">{st?.first_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Nom</span>
                        <span className="font-extrabold text-white">{st?.last_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Post-nom</span>
                        <span className="font-bold text-slate-300">{st?.middle_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Sexe</span>
                        <span className="font-bold text-slate-200">{st?.gender === 'M' ? 'Masculin (M)' : st?.gender === 'F' ? 'Féminin (F)' : 'Non précisé'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-amber-400" />
                      <span>Naissance & Contacts</span>
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Date de Naissance</span>
                        <span className="font-bold text-slate-200">{st?.date_of_birth || 'Non renseignée'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Lieu de Naissance</span>
                        <span className="font-bold text-slate-200">{st?.birth_place || 'Non renseigné'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Tuteur / Contact</span>
                        <span className="font-bold text-amber-300">{st?.guardian_reference || 'Non renseigné'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Statut Inscription</span>
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-bold text-[10px]">
                          {st?.enrollment_status || 'active'}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Compte Numérique</span>
                        <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full font-bold text-[10px]">
                          {st?.account_status || 'not_invited'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: INSCRIPTIONS & HISTORIQUE CLASSES */}
              {activeTab === 'enrollment' && (
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-indigo-300 font-bold">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                      <span>Classe Actuelle : {st?.current_class_name || 'Aucune classe affectée'}</span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Les changements de classe sont gérés exclusivement via l’action "Changer classe".
                    </span>
                  </div>

                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Historique des Inscriptions</h3>
                  {enrollments.length === 0 ? (
                    <div className="p-6 text-center bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-400">
                      Aucun historique d’inscription enregistré.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                            <th className="p-3">Classe</th>
                            <th className="p-3">Statut</th>
                            <th className="p-3">Date d’Inscription</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {enrollments.map((enr: any) => (
                            <tr key={enr.id} className="hover:bg-slate-800/40">
                              <td className="p-3 font-extrabold text-white">{enr.class_name || 'N/A'}</td>
                              <td className="p-3">
                                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-bold text-[10px]">
                                  {enr.status || 'active'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-300">{enr.enrolled_at ? new Date(enr.enrolled_at).toLocaleDateString() : 'N/A'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: PRÉSENCES & RÉSULTATS ACADÉMIQUES */}
              {activeTab === 'attendance' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-1">
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Présences</p>
                      <p className="text-base font-black text-emerald-400">{attendance.present_count || 0}</p>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-1">
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Absences</p>
                      <p className="text-base font-black text-rose-400">{attendance.absent_count || 0}</p>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-1">
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Retards</p>
                      <p className="text-base font-black text-amber-400">{attendance.late_count || 0}</p>
                    </div>
                    <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-1">
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Excusees</p>
                      <p className="text-base font-black text-indigo-400">{attendance.excused_count || 0}</p>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-2 text-xs">
                    <h3 className="font-extrabold text-white flex items-center gap-1.5">
                      <FileCheck className="w-4 h-4 text-amber-400" />
                      <span>Activité Évaluative</span>
                    </h3>
                    <div className="flex justify-between text-slate-300 pt-1">
                      <span>Évaluations enregistrées :</span>
                      <span className="font-bold text-white">{academic.total_assessments || 0}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span>Bulletins de notes générés :</span>
                      <span className="font-bold text-white">{academic.report_cards_count || 0}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: SITUATION FINANCIÈRE */}
              {activeTab === 'finance' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Total Facturé</p>
                      <p className="text-lg font-black text-white">{financial.total_invoiced || 0} FCFA / USD</p>
                    </div>
                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Total Payé</p>
                      <p className="text-lg font-black text-emerald-400">{financial.total_paid || 0} FCFA / USD</p>
                    </div>
                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Solde Dû</p>
                      <p className="text-lg font-black text-amber-400">{financial.balance_due || 0} FCFA / USD</p>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* MODE ÉDITION */
            <form onSubmit={handleSaveClick} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center gap-2 text-amber-300">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Seules les données personnelles peuvent être modifiées ici. Le matricule et la classe ne peuvent pas être modifiés dans ce formulaire.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Champs verrouillés */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-400 flex items-center gap-1">
                    <span>Matricule Scolaire</span>
                    <Lock className="w-3 h-3 text-slate-500" />
                  </label>
                  <input
                    type="text"
                    disabled
                    value={st?.student_number || ''}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono font-bold text-slate-500 cursor-not-allowed"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-400 flex items-center gap-1">
                    <span>Classe Actuelle</span>
                    <Lock className="w-3 h-3 text-slate-500" />
                  </label>
                  <input
                    type="text"
                    disabled
                    value={st?.current_class_name || 'Sans classe'}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl font-bold text-slate-500 cursor-not-allowed"
                  />
                </div>

                {/* Champs modifiables */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-300">
                    Prénom <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">
                    Nom <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Post-nom (Second prénom)</label>
                  <input
                    type="text"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Sexe</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as 'M' | 'F' | '')}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none cursor-pointer"
                  >
                    <option value="">Non précisé</option>
                    <option value="M">Masculin (M)</option>
                    <option value="F">Féminin (F)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Date de Naissance</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Lieu de Naissance</label>
                  <input
                    type="text"
                    value={birthPlace}
                    onChange={(e) => setBirthPlace(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none"
                  />
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label className="font-bold text-slate-300">Tuteur / Téléphone de Contact</label>
                  <input
                    type="text"
                    value={guardianReference}
                    onChange={(e) => setGuardianReference(e.target.value)}
                    placeholder="Ex: M. Jean Kabila (0810000000)"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl cursor-pointer shadow-md flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" />
                  <span>Enregistrer les Modifications</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Confirmation Modal */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
              <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <span>Confirmer la Modification</span>
              </h3>
              <p className="text-xs text-slate-300">
                Voulez-vous vraiment enregistrer ces modifications personnelles pour l’élève{' '}
                <strong className="text-white">{firstName} {lastName}</strong> ?
              </p>
              <div className="flex justify-end gap-2 pt-2 text-xs">
                <button
                  disabled={submitting}
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  disabled={submitting}
                  onClick={confirmUpdate}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  {submitting ? 'Enregistrement...' : 'Confirmer et Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
