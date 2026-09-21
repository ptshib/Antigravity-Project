import React, { useState, useEffect } from 'react';
import {
  X,
  UserCheck,
  BookOpen,
  Phone,
  Mail,
  Edit3,
  Save,
  Lock,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Layers
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface TeacherDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  teacherId: string | null;
  initialMode?: 'view' | 'edit';
  onTeacherUpdated?: () => void;
}

export const TeacherDossierModal: React.FC<TeacherDossierModalProps> = ({
  isOpen,
  onClose,
  teacherId,
  initialMode = 'view',
  onTeacherUpdated
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [activeTab, setActiveTab] = useState<'info' | 'assignments'>('info');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [dossier, setDossier] = useState<any>(null);

  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | ''>('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [speciality, setSpeciality] = useState('');

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setSuccessMessage(null);
    if (isOpen && teacherId) {
      loadDossier();
    }
  }, [isOpen, teacherId, initialMode]);

  const loadDossier = async () => {
    if (!teacherId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_teacher_full_dossier', {
        p_teacher_id: teacherId
      });

      if (rpcErr) {
        throw rpcErr;
      }

      setDossier(data);
      if (data?.teacher) {
        setFirstName(data.teacher.first_name || '');
        setLastName(data.teacher.last_name || '');
        setGender(data.teacher.gender || '');
        setEmail(data.teacher.email || '');
        setPhone(data.teacher.phone || '');
        setSpeciality(data.teacher.speciality || '');
      }
    } catch (err: any) {
      console.error('Erreur chargement dossier enseignant:', err);
      setError(err.message || 'Impossible de charger le dossier de l’enseignant.');
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
    if (!teacherId) return;
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const { error: updateErr } = await supabase.rpc('update_teacher_personal_info', {
        p_teacher_id: teacherId,
        p_first_name: firstName.trim(),
        p_last_name: lastName.trim(),
        p_gender: gender || null,
        p_email: email.trim() || null,
        p_phone: phone.trim() || null,
        p_speciality: speciality.trim() || null
      });

      if (updateErr) {
        throw updateErr;
      }

      setSuccessMessage('Les coordonnées de l’enseignant ont été mises à jour avec succès.');
      setShowConfirmModal(false);
      setMode('view');
      await loadDossier();
      if (onTeacherUpdated) {
        onTeacherUpdated();
      }
    } catch (err: any) {
      console.error('Erreur mise à jour enseignant:', err);
      setError(err.message || 'Échec de la mise à jour des coordonnées.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const tch = dossier?.teacher;
  const assignments = dossier?.assignments || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <UserCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-white">
                  {tch ? `${tch.first_name} ${tch.last_name}` : 'Fiche Enseignant'}
                </h2>
                {tch?.employee_number && (
                  <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-mono text-xs font-bold">
                    {tch.employee_number}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Spécialité : {tch?.speciality || 'Général'}
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
                <UserCheck className="w-4 h-4" />
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
              <p className="text-xs font-bold text-slate-400">Chargement du dossier enseignant...</p>
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
                  <Briefcase className="w-4 h-4" />
                  <span>Profil Professionnel & Contact</span>
                </button>

                <button
                  onClick={() => setActiveTab('assignments')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'assignments'
                      ? 'bg-amber-500 text-slate-950 shadow-md'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>Matières & Classes Affectées ({assignments.length})</span>
                </button>
              </div>

              {/* TAB 1: INFORMATIONS PROFESSIONNELLES */}
              {activeTab === 'info' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Briefcase className="w-4 h-4 text-amber-400" />
                      <span>Informations Agent</span>
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Matricule</span>
                        <span className="font-mono font-bold text-amber-400">{tch?.employee_number || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Prénom</span>
                        <span className="font-extrabold text-white">{tch?.first_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Nom</span>
                        <span className="font-extrabold text-white">{tch?.last_name || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Sexe</span>
                        <span className="font-bold text-slate-200">{tch?.gender === 'M' ? 'Masculin (M)' : tch?.gender === 'F' ? 'Féminin (F)' : 'Non précisé'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Spécialité</span>
                        <span className="font-bold text-amber-300">{tch?.speciality || 'Général'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-amber-400" />
                      <span>Coordonnées & Statuts</span>
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Email</span>
                        <span className="font-mono font-bold text-slate-200">{tch?.email || 'Non renseigné'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Téléphone</span>
                        <span className="font-mono font-bold text-slate-200">{tch?.phone || 'Non renseigné'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Statut d’Emploi</span>
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-bold text-[10px]">
                          {tch?.employment_status || 'active'}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-800/60 pb-1.5">
                        <span className="text-slate-400 font-medium">Compte Numérique</span>
                        <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full font-bold text-[10px]">
                          {tch?.account_status || 'not_invited'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: AFFECTATIONS */}
              {activeTab === 'assignments' && (
                <div className="space-y-4">
                  <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl flex items-center justify-between text-xs text-indigo-300 font-bold">
                    <span>Affectations de cours ({assignments.length})</span>
                    <span className="text-[11px] text-slate-400 font-normal">
                      Les affectations de cours sont gérées via l’action "Affectations".
                    </span>
                  </div>

                  {assignments.length === 0 ? (
                    <div className="p-6 text-center bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-400">
                      Aucune affectation de cours enregistrée pour cet enseignant.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                            <th className="p-3">Classe</th>
                            <th className="p-3">Matière</th>
                            <th className="p-3">Période / Terme</th>
                            <th className="p-3">Statut</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {assignments.map((as: any) => (
                            <tr key={as.assignment_id} className="hover:bg-slate-800/40">
                              <td className="p-3 font-extrabold text-white flex items-center gap-1.5">
                                <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                                <span>{as.class_name || 'Toutes les classes'}</span>
                              </td>
                              <td className="p-3 font-bold text-amber-300">{as.subject_name || 'N/A'}</td>
                              <td className="p-3 text-slate-300">{as.term_name || 'Année entière'}</td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                  as.is_active ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                                }`}>
                                  {as.is_active ? 'Actif' : 'Inactif'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* MODE ÉDITION */
            <form onSubmit={handleSaveClick} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center gap-2 text-amber-300">
                <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  Seules les coordonnées professionnelles peuvent être modifiées. Le matricule n'est pas modifiable.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Champ verrouillé */}
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-bold text-slate-400 flex items-center gap-1">
                    <span>Matricule Enseignant</span>
                    <Lock className="w-3 h-3 text-slate-500" />
                  </label>
                  <input
                    type="text"
                    disabled
                    value={tch?.employee_number || ''}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono font-bold text-slate-500 cursor-not-allowed"
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
                  <label className="font-bold text-slate-300">Spécialité</label>
                  <input
                    type="text"
                    value={speciality}
                    onChange={(e) => setSpeciality(e.target.value)}
                    placeholder="Ex: Mathématiques, Physique-Chimie"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-bold text-white outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Adresse Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="enseignant@ecole.cd"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-mono font-bold text-white outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-300">Téléphone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0990000000"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl font-mono font-bold text-white outline-none"
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
                Voulez-vous vraiment enregistrer les modifications pour l’enseignant{' '}
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
