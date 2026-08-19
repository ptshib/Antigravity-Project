import React, { useState, useEffect } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import { Logo } from '../../components/common/Logo';
import { Modal } from '../../components/common/Modal';
import {
  ShieldCheck,
  School as SchoolIcon,
  Plus,
  LogOut,
  Search,
  Users,
  RefreshCw,
  AlertCircle,
  Lock,
  Eye,
  Ban,
  Trash2,
  Archive
} from 'lucide-react';

interface RealSchoolRow {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
  education_cycles?: string[];
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  country?: string | null;
  timezone: string;
  status: 'active' | 'suspended' | 'archived';
  created_at: string;
  updated_at: string;
}

interface LinkedCounts {
  profiles: number;
  classes: number;
  students: number;
  years: number;
  total: number;
}

interface SuperAdminDashboardProps {
  onSelectSchool: (schoolId: string) => void;
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ onSelectSchool }) => {
  const { profile, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  // State
  const [schools, setSchools] = useState<RealSchoolRow[]>([]);
  const [totalUserCount, setTotalUserCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [suspendingSchool, setSuspendingSchool] = useState<RealSchoolRow | null>(null);
  const [suspensionReason, setSuspensionReason] = useState<string>('');

  // Deletion Modal State
  const [deletingSchool, setDeletingSchool] = useState<RealSchoolRow | null>(null);
  const [linkedCounts, setLinkedCounts] = useState<LinkedCounts | null>(null);
  const [checkingLinked, setCheckingLinked] = useState<boolean>(false);
  const [formConfirmDeleteName, setFormConfirmDeleteName] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Form State for new school Wizard
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formWhatsapp, setFormWhatsapp] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formCountry, setFormCountry] = useState('RD Congo');
  const [formTimezone, setFormTimezone] = useState('Africa/Kinshasa');
  const [formCycles, setFormCycles] = useState<'primary' | 'secondary' | 'both'>('both');
  const [formCreateYear, setFormCreateYear] = useState<boolean>(true);
  const [formYearName, setFormYearName] = useState<string>('2026–2027');
  const [formYearStartsOn, setFormYearStartsOn] = useState<string>('2026-09-01');
  const [formYearEndsOn, setFormYearEndsOn] = useState<string>('2027-07-02');
  const [formYearIsCurrent, setFormYearIsCurrent] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const fetchSuperAdminData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data: schoolsData, error: schoolsErr } = await supabase
        .from('schools')
        .select('*')
        .order('created_at', { ascending: false });

      if (schoolsErr) throw schoolsErr;

      const { count: profileCount, error: profilesErr } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      if (profilesErr) throw profilesErr;

      setSchools(schoolsData || []);
      setTotalUserCount(profileCount || 0);
    } catch (err: any) {
      console.error('Error fetching Supabase SuperAdmin data:', err);
      setErrorMsg(err.message || 'Impossible de se connecter au serveur Supabase pour charger les établissements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuperAdminData();
  }, []);

  const handleNameChange = (val: string) => {
    setFormName(val);
    const autoSlug = val
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    setFormSlug(autoSlug);
  };

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = formName.trim();
    const cleanSlug = formSlug.trim().toLowerCase();

    if (!cleanName) {
      setFormError("Le nom de l'établissement est obligatoire.");
      setWizardStep(1);
      return;
    }

    if (!cleanSlug) {
      setFormError("L'identifiant slug est obligatoire.");
      setWizardStep(1);
      return;
    }

    if (!/^[a-z0-9-]+$/.test(cleanSlug)) {
      setFormError("Le slug ne doit contenir que des lettres minuscules, chiffres et tirets.");
      setWizardStep(1);
      return;
    }

    if (formCreateYear) {
      if (!formYearName.trim()) {
        setFormError("L'intitulé de la première année scolaire est obligatoire.");
        setWizardStep(3);
        return;
      }
      if (!formYearStartsOn || !formYearEndsOn) {
        setFormError("Les dates de début et de fin de l'année scolaire sont obligatoires.");
        setWizardStep(3);
        return;
      }
      if (formYearStartsOn >= formYearEndsOn) {
        setFormError("La date de début doit être strictement antérieure à la date de fin.");
        setWizardStep(3);
        return;
      }
    }

    setIsCreating(true);
    try {
      const cyclesArray = formCycles === 'both' ? ['primary', 'secondary'] : [formCycles];

      const { error: rpcErr } = await supabase.rpc('create_school_with_initial_setup', {
        p_name: cleanName,
        p_slug: cleanSlug,
        p_education_cycles: cyclesArray,
        p_phone: formPhone.trim() || null,
        p_whatsapp: formWhatsapp.trim() || null,
        p_email: formEmail.trim() || null,
        p_address: formAddress.trim() || null,
        p_country: formCountry.trim() || 'RD Congo',
        p_timezone: formTimezone.trim() || 'Africa/Kinshasa',
        p_create_academic_year: formCreateYear,
        p_academic_year_name: formCreateYear ? formYearName.trim() : null,
        p_academic_year_starts_on: formCreateYear ? formYearStartsOn : null,
        p_academic_year_ends_on: formCreateYear ? formYearEndsOn : null,
        p_academic_year_is_current: formCreateYear ? formYearIsCurrent : true
      });

      if (rpcErr) throw rpcErr;

      showToast(`Établissement "${cleanName}" créé avec succès avec son Calendrier Scolaire RDC !`, 'success');
      setShowCreateModal(false);
      setWizardStep(1);
      setFormName('');
      setFormSlug('');
      setFormPhone('');
      setFormWhatsapp('');
      setFormEmail('');
      setFormAddress('');
      fetchSuperAdminData();
    } catch (err: any) {
      console.error('Error creating school with wizard:', err);
      setFormError(err.message || "Erreur lors de la création de l'établissement dans Supabase.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmSuspension = async () => {
    if (!suspendingSchool) return;
    const newStatus = suspendingSchool.status === 'active' ? 'suspended' : 'active';
    try {
      const { error } = await supabase
        .from('schools')
        .update({
          status: newStatus,
          suspension_reason: newStatus === 'suspended' ? (suspensionReason.trim() || 'Motif administratif') : null,
          suspended_at: newStatus === 'suspended' ? new Date().toISOString() : null,
          suspended_by: newStatus === 'suspended' ? profile?.id : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', suspendingSchool.id);

      if (error) throw error;

      await supabase.from('school_audit_logs').insert({
        school_id: suspendingSchool.id,
        actor_id: profile?.id || null,
        action: newStatus === 'suspended' ? 'school_suspended' : 'school_reactivated',
        details: { reason: suspensionReason }
      });

      showToast(`Statut de "${suspendingSchool.name}" changé vers ${newStatus.toUpperCase()}`, 'info');
      setSuspendingSchool(null);
      setSuspensionReason('');
      fetchSuperAdminData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du changement de statut.', 'warning');
    }
  };

  // Trigger Deletion Modal & Check Linked Records
  const handleOpenDeleteModal = async (school: RealSchoolRow) => {
    setDeletingSchool(school);
    setFormConfirmDeleteName('');
    setDeleteError(null);
    setCheckingLinked(true);

    try {
      const [{ count: profCount }, { count: classCount }, { count: studentCount }, { count: yearCount }] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
        supabase.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
        supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', school.id),
        supabase.from('academic_years').select('id', { count: 'exact', head: true }).eq('school_id', school.id)
      ]);

      const profs = profCount || 0;
      const cls = classCount || 0;
      const stds = studentCount || 0;
      const yrs = yearCount || 0;

      setLinkedCounts({
        profiles: profs,
        classes: cls,
        students: stds,
        years: yrs,
        total: profs + cls + stds + yrs
      });
    } catch (err: any) {
      console.error('Error checking linked records:', err);
      setLinkedCounts({ profiles: 0, classes: 0, students: 0, years: 0, total: 0 });
    } finally {
      setCheckingLinked(false);
    }
  };

  // Execute Archiving
  const handleArchiveSchool = async (school: RealSchoolRow) => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { error } = await supabase
        .from('schools')
        .update({
          status: 'archived',
          updated_at: new Date().toISOString()
        })
        .eq('id', school.id);

      if (error) throw error;

      await supabase.from('school_audit_logs').insert({
        school_id: school.id,
        actor_id: profile?.id || null,
        action: 'school_archived',
        details: { reason: 'Archivage sécurisé par le Super-Admin' }
      });

      showToast(`Établissement "${school.name}" archivé avec succès !`, 'success');
      setDeletingSchool(null);
      fetchSuperAdminData();
    } catch (err: any) {
      setDeleteError(err.message || "Impossible d'archiver l'établissement.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Execute Hard Delete (For Empty Schools Only)
  const handleExecuteHardDelete = async (school: RealSchoolRow) => {
    if (formConfirmDeleteName.trim() !== school.name.trim()) {
      setDeleteError(`Le nom saisi ne correspond pas exactement à "${school.name}".`);
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const { error } = await supabase
        .from('schools')
        .delete()
        .eq('id', school.id);

      if (error) throw error;

      showToast(`Établissement "${school.name}" supprimé définitivement de Supabase !`, 'success');
      setDeletingSchool(null);
      fetchSuperAdminData();
    } catch (err: any) {
      console.error('Error executing delete:', err);
      setDeleteError(
        err.message || "Erreur Supabase : impossible de supprimer définitivement cet établissement. Réessayez d'archiver."
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredSchools = schools.filter(s =>
    `${s.name} ${s.slug} ${s.country || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeSchoolsCount = schools.filter(s => s.status === 'active').length;
  const suspendedSchoolsCount = schools.filter(s => s.status === 'suspended').length;
  const archivedSchoolsCount = schools.filter(s => s.status === 'archived').length;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-rose-500 selection:text-white">
      {/* Header Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="px-3 py-1 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full text-xs font-bold uppercase tracking-wider">
            Super-Admin PaTShi-Digital
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-white">{profile?.first_name} {profile?.last_name}</p>
            <p className="text-[10px] text-rose-400 font-mono">PaTShi-Digital Root Admin</p>
          </div>
          <button
            onClick={signOutReal}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-colors cursor-pointer border border-slate-700"
            title="Se déconnecter de la console"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-8">
        {/* Welcome Banner */}
        <div className="bg-gradient-to-r from-rose-950 via-slate-900 to-slate-900 border border-rose-800/40 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <h1 className="text-2xl sm:text-3xl font-black text-white">Registre Central des Établissements</h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Supervision globale multi-écoles en direct sur Supabase. Cliquez sur « Superviser » sur une école pour ouvrir sa console d'administration complète.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={fetchSuperAdminData}
              className="p-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl border border-slate-700 transition-colors cursor-pointer"
              title="Rafraîchir les données"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={() => {
                setFormError(null);
                setShowCreateModal(true);
              }}
              className="px-6 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-2xl shadow-xl transition-all flex items-center gap-2 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Nouveau Complexe Scolaire</span>
            </button>
          </div>
        </div>

        {/* Global Network Error Banner */}
        {errorMsg && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between gap-4 text-rose-300 text-xs">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={fetchSuperAdminData}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs shrink-0 cursor-pointer"
            >
              Réessayer
            </button>
          </div>
        )}

        {/* Metrics Cards */}
        <div className="grid sm:grid-cols-3 gap-6">
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-rose-400">
              <SchoolIcon className="w-6 h-6" />
              <span className="text-[10px] font-bold uppercase bg-rose-500/10 px-2.5 py-0.5 rounded-full text-rose-300">
                {activeSchoolsCount} Active(s)
              </span>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase">Établissements Réels</p>
            <p className="text-3xl font-black text-white">{schools.length} Écoles</p>
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400">
              {suspendedSchoolsCount > 0 && <span className="text-amber-400">{suspendedSchoolsCount} suspendue(s)</span>}
              {archivedSchoolsCount > 0 && <span className="text-slate-500">{archivedSchoolsCount} archivée(s)</span>}
            </div>
          </div>

          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-emerald-400">
              <Users className="w-6 h-6" />
              <span className="text-[10px] font-bold uppercase bg-emerald-500/10 px-2.5 py-0.5 rounded-full text-emerald-300">
                Supabase Auth
              </span>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase">Utilisateurs Enregistrés</p>
            <p className="text-3xl font-black text-white">{totalUserCount} Profils</p>
          </div>

          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-amber-400">
              <ShieldCheck className="w-6 h-6" />
              <span className="text-[10px] font-bold uppercase bg-amber-500/10 px-2.5 py-0.5 rounded-full text-amber-300">
                RLS Configurée
              </span>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase">Statut Sécurité Base</p>
            <p className="text-base font-extrabold text-emerald-400 flex items-center gap-1.5 pt-1">
              <Lock className="w-4 h-4" />
              <span>Isolation Multi-Écoles Active</span>
            </p>
          </div>
        </div>

        {/* Master Schools Table */}
        <div className="bg-slate-900 rounded-3xl border border-slate-800 p-6 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h2 className="font-extrabold text-base text-white">Registre Réel des Établissements</h2>
              <p className="text-xs text-slate-400">Données issues directement de la table <code>public.schools</code></p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-300 absolute left-3.5 top-3.5" />
              <input
                type="text"
                placeholder="Rechercher nom, slug ou pays..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border-2 border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 placeholder:text-slate-400 font-medium transition-all"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs text-slate-400 space-y-2">
              <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p>Chargement des établissements depuis Supabase...</p>
            </div>
          ) : filteredSchools.length === 0 ? (
            <div className="p-12 text-center bg-slate-950 rounded-2xl border border-slate-800/80 space-y-4">
              <SchoolIcon className="w-12 h-12 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <h3 className="font-bold text-slate-300 text-sm">Aucun établissement n’a encore été créé.</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  La base de données réelle ne contient aucune école. Cliquez ci-dessous pour enregistrer le premier établissement partenaire.
                </p>
              </div>
              <button
                onClick={() => {
                  setFormError(null);
                  setShowCreateModal(true);
                }}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-colors"
              >
                Créer le premier établissement
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[700px] text-xs">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                    <th className="p-4">Établissement</th>
                    <th className="p-4">Slug (Identifiant)</th>
                    <th className="p-4">Cycles Organisés</th>
                    <th className="p-4">Pays / Adresse</th>
                    <th className="p-4">Statut</th>
                    <th className="p-4">Créé le</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredSchools.map(s => (
                    <tr key={s.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-4">
                        <span className="font-bold text-white block">{s.name}</span>
                        {s.email && <span className="text-[11px] text-slate-400">{s.email}</span>}
                      </td>
                      <td className="p-4 font-mono text-amber-400 font-semibold">{s.slug}</td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {(!s.education_cycles || s.education_cycles.includes('primary')) && (
                            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-full font-bold text-[10px]">
                              Primaire
                            </span>
                          )}
                          {(!s.education_cycles || s.education_cycles.includes('secondary')) && (
                            <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full font-bold text-[10px]">
                              Secondaire
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-slate-300">
                        <span className="block font-medium">{s.country || 'RD Congo'}</span>
                        {s.address ? (
                          <span className="text-[11px] text-slate-400 block">{s.address}</span>
                        ) : (
                          <span className="text-[10px] text-slate-500 italic block">Adresse non renseignée</span>
                        )}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded-full font-bold text-[10px] uppercase border ${
                            s.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : s.status === 'archived'
                              ? 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                              : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          {s.status === 'active' ? 'Actif' : s.status === 'archived' ? 'Archivé' : 'Suspendu'}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-slate-400 text-[11px]">
                        {new Date(s.created_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="p-4 flex items-center gap-2">
                        {/* Direct Navigation to Full Supervision Console */}
                        <button
                          onClick={() => onSelectSchool(s.id)}
                          className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-colors"
                          title="Ouvrir la Console de Supervision Plein Écran"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Superviser</span>
                        </button>

                        {/* Suspend / Activate */}
                        <button
                          onClick={() => setSuspendingSchool(s)}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                            s.status === 'active'
                              ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30'
                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          }`}
                          title={s.status === 'active' ? 'Suspendre l’école' : 'Activer l’école'}
                        >
                          <Ban className="w-4 h-4" />
                        </button>

                        {/* Delete / Archive Button */}
                        <button
                          onClick={() => handleOpenDeleteModal(s)}
                          className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg transition-colors cursor-pointer"
                          title="Supprimer ou Archiver l’établissement"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Modal: Assistant de création d'école en 4 étapes */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setWizardStep(1);
        }}
        title="Assistant de Création d’Établissement & Calendrier Scolaire"
        darkMode={true}
        maxWidth="2xl"
      >
        <div className="space-y-5">
          {/* Stepper Header */}
          <div className="grid grid-cols-4 gap-2 text-center text-xs pb-3 border-b border-slate-800">
            <button
              type="button"
              onClick={() => setWizardStep(1)}
              className={`p-2 rounded-xl font-bold transition-all ${
                wizardStep === 1 ? 'bg-rose-600 text-white shadow-md' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              1. Identité
            </button>
            <button
              type="button"
              onClick={() => setWizardStep(2)}
              className={`p-2 rounded-xl font-bold transition-all ${
                wizardStep === 2 ? 'bg-rose-600 text-white shadow-md' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              2. Cycles
            </button>
            <button
              type="button"
              onClick={() => setWizardStep(3)}
              className={`p-2 rounded-xl font-bold transition-all ${
                wizardStep === 3 ? 'bg-rose-600 text-white shadow-md' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              3. Année
            </button>
            <button
              type="button"
              onClick={() => setWizardStep(4)}
              className={`p-2 rounded-xl font-bold transition-all ${
                wizardStep === 4 ? 'bg-rose-600 text-white shadow-md' : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              4. Aperçu
            </button>
          </div>

          {formError && (
            <div className="p-3.5 bg-rose-500/10 border-2 border-rose-500/40 rounded-xl text-rose-300 text-xs font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleCreateSchool} className="space-y-4">
            {/* STEP 1: IDENTITÉ */}
            {wizardStep === 1 && (
              <div className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                    Nom de l'Établissement *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Complexe Scolaire Les Horizons"
                    value={formName}
                    onChange={e => handleNameChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                    Identifiant Unique / Slug * <span className="text-[10px] text-amber-400 font-normal lowercase">(minuscules, tirets)</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="les-horizons"
                    value={formSlug}
                    onChange={e => setFormSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-amber-500/70 rounded-xl text-sm font-mono text-amber-300 font-bold focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Téléphone</label>
                    <input
                      type="tel"
                      placeholder="+243 819 883 084"
                      value={formPhone}
                      onChange={e => setFormPhone(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">WhatsApp Officiel</label>
                    <input
                      type="tel"
                      placeholder="+420 776 308 018"
                      value={formWhatsapp}
                      onChange={e => setFormWhatsapp(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Adresse Email</label>
                    <input
                      type="email"
                      placeholder="contact@leshorizons.cd"
                      value={formEmail}
                      onChange={e => setFormEmail(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Pays</label>
                    <input
                      type="text"
                      value={formCountry}
                      onChange={e => setFormCountry(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Adresse physique</label>
                    <input
                      type="text"
                      placeholder="Avenue Ma Campagne, Ngaliema"
                      value={formAddress}
                      onChange={e => setFormAddress(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Fuseau Horaire</label>
                    <select
                      value={formTimezone}
                      onChange={e => setFormTimezone(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 cursor-pointer"
                    >
                      <option value="Africa/Kinshasa" className="bg-slate-900 text-white">Africa/Kinshasa (RD Congo)</option>
                      <option value="Africa/Lubumbashi" className="bg-slate-900 text-white">Africa/Lubumbashi (RD Congo Est)</option>
                      <option value="Africa/Brazzaville" className="bg-slate-900 text-white">Africa/Brazzaville (Congo)</option>
                      <option value="Europe/Paris" className="bg-slate-900 text-white">Europe/Paris (France)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: CYCLES ORGANISÉS */}
            {wizardStep === 2 && (
              <div className="space-y-4 text-xs">
                <p className="text-slate-300 font-medium">
                  Sélectionnez les cycles d'enseignement organisés par cet établissement. Le Calendrier Scolaire correspondant sera configuré en conséquence :
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div
                    onClick={() => setFormCycles('primary')}
                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                      formCycles === 'primary'
                        ? 'bg-blue-600/20 border-blue-500 text-white shadow-lg'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-extrabold text-sm text-blue-400 mb-1">Primaire Uniquement</div>
                    <p className="text-[11px] text-slate-400">3 Trimestres • 9 Périodes d'évaluation</p>
                  </div>

                  <div
                    onClick={() => setFormCycles('secondary')}
                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                      formCycles === 'secondary'
                        ? 'bg-purple-600/20 border-purple-500 text-white shadow-lg'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-extrabold text-sm text-purple-400 mb-1">Secondaire Uniquement</div>
                    <p className="text-[11px] text-slate-400">2 Semestres • 4 Périodes d'évaluation</p>
                  </div>

                  <div
                    onClick={() => setFormCycles('both')}
                    className={`p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                      formCycles === 'both'
                        ? 'bg-rose-600/20 border-rose-500 text-white shadow-lg'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-extrabold text-sm text-rose-400 mb-1">Primaire & Secondaire</div>
                    <p className="text-[11px] text-slate-400">Structure mixte complète</p>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: PREMIÈRE ANNÉE SCOLAIRE */}
            {wizardStep === 3 && (
              <div className="space-y-4 text-xs">
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white block">Configurer la Première Année Scolaire</span>
                    <span className="text-[11px] text-slate-400">Génère automatiquement le Calendrier Scolaire RDC</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formCreateYear}
                    onChange={e => setFormCreateYear(e.target.checked)}
                    className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
                  />
                </div>

                {formCreateYear && (
                  <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                    <div>
                      <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1">
                        Intitulé de l'Année Scolaire *
                      </label>
                      <input
                        type="text"
                        required={formCreateYear}
                        value={formYearName}
                        onChange={e => setFormYearName(e.target.value)}
                        placeholder="2026–2027"
                        className="w-full px-3.5 py-2 bg-slate-900 border-2 border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-rose-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1">
                          Date de Début *
                        </label>
                        <input
                          type="date"
                          required={formCreateYear}
                          value={formYearStartsOn}
                          onChange={e => setFormYearStartsOn(e.target.value)}
                          className="w-full px-3.5 py-2 bg-slate-900 border-2 border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1">
                          Date de Fin *
                        </label>
                        <input
                          type="date"
                          required={formCreateYear}
                          value={formYearEndsOn}
                          onChange={e => setFormYearEndsOn(e.target.value)}
                          className="w-full px-3.5 py-2 bg-slate-900 border-2 border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        id="isCurrentYear"
                        checked={formYearIsCurrent}
                        onChange={e => setFormYearIsCurrent(e.target.checked)}
                        className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
                      />
                      <label htmlFor="isCurrentYear" className="text-slate-300 cursor-pointer font-medium">
                        Définir immédiatement comme année scolaire courante active
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: APERÇU & CONFIRMATION */}
            {wizardStep === 4 && (
              <div className="space-y-4 text-xs">
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                  <h4 className="font-extrabold text-white text-sm">Résumé de la Configuration :</h4>
                  <div className="grid grid-cols-2 gap-2 text-slate-300">
                    <div><span className="text-slate-500">Nom :</span> <strong className="text-white">{formName || 'N/A'}</strong></div>
                    <div><span className="text-slate-500">Slug :</span> <strong className="font-mono text-amber-400">{formSlug || 'N/A'}</strong></div>
                    <div><span className="text-slate-500">Cycles :</span> <strong className="text-rose-400">{formCycles === 'both' ? 'Primaire & Secondaire' : formCycles === 'primary' ? 'Primaire' : 'Secondaire'}</strong></div>
                    <div><span className="text-slate-500">Année :</span> <strong className="text-emerald-400">{formCreateYear ? formYearName : 'À configurer ultérieurement'}</strong></div>
                  </div>
                </div>

                {formCreateYear && (
                  <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                    <h4 className="font-extrabold text-white text-xs uppercase tracking-wider">
                      Calendrier Scolaire RDC qui sera généré :
                    </h4>

                    {(formCycles === 'primary' || formCycles === 'both') && (
                      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl space-y-1 text-[11px]">
                        <span className="font-bold text-blue-300 block">Cycle Primaire :</span>
                        <p className="text-slate-300">3 Trimestres (1er, 2e, 3e Trimestre) • 9 Périodes (1re à 9e Période, réparties 3 par trimestre)</p>
                      </div>
                    )}

                    {(formCycles === 'secondary' || formCycles === 'both') && (
                      <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl space-y-1 text-[11px]">
                        <span className="font-bold text-purple-300 block">Cycle Secondaire :</span>
                        <p className="text-slate-300">2 Semestres (1er, 2e Semestre) • 4 Périodes (1re à 4e Période, réparties 2 par semestre)</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Stepper Footer Controls */}
            <div className="flex justify-between items-center pt-3 border-t border-slate-800">
              {wizardStep > 1 ? (
                <button
                  type="button"
                  onClick={() => setWizardStep((prev) => (prev - 1) as any)}
                  className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl cursor-pointer transition-colors"
                >
                  ← Précédent
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white rounded-xl cursor-pointer"
                >
                  Annuler
                </button>
              )}

              {wizardStep < 4 ? (
                <button
                  type="button"
                  onClick={() => setWizardStep((prev) => (prev + 1) as any)}
                  className="px-5 py-2 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md cursor-pointer transition-colors"
                >
                  Suivant →
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-6 py-2.5 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-lg cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {isCreating ? 'Création & Configuration...' : 'Créer l’Établissement & Générer le Calendrier'}
                </button>
              )}
            </div>
          </form>
        </div>
      </Modal>

      {/* Modal Confirmation Suspension */}
      {suspendingSchool && (
        <Modal
          isOpen={!!suspendingSchool}
          onClose={() => setSuspendingSchool(null)}
          title={suspendingSchool.status === 'active' ? "Suspendre l’Établissement" : "Réactiver l’Établissement"}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <p className="text-slate-300">
              {suspendingSchool.status === 'active'
                ? `Êtes-vous sûr de vouloir suspendre l'accès pour "${suspendingSchool.name}" ? Les comptes associés seront bloqués.`
                : `Réactiver l'accès pour "${suspendingSchool.name}" ?`}
            </p>

            {suspendingSchool.status === 'active' && (
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                  Motif de suspension *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Précisez la raison..."
                  value={suspensionReason}
                  onChange={e => setSuspensionReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSuspendingSchool(null)}
                className="px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmSuspension}
                className={`px-5 py-2.5 text-xs font-extrabold rounded-xl shadow-md text-white ${
                  suspendingSchool.status === 'active' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                Confirmer {suspendingSchool.status === 'active' ? 'la Suspension' : 'la Réactivation'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Suppression / Archivage de l’établissement */}
      {deletingSchool && (
        <Modal
          isOpen={!!deletingSchool}
          onClose={() => setDeletingSchool(null)}
          title="Suppression ou Archivage de l’Établissement"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            {/* Warning Message */}
            <div className="p-4 bg-rose-500/10 border-2 border-rose-500/40 rounded-2xl flex items-start gap-3 text-rose-200">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed font-medium">
                Vous êtes sur le point de supprimer définitivement cet établissement. Cette opération peut également affecter toutes les données scolaires qui lui sont liées.
              </p>
            </div>

            {/* Checking Linked Status */}
            {checkingLinked ? (
              <div className="p-6 text-center text-slate-400 space-y-2">
                <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="font-semibold text-xs">Vérification de l’existence de données rattachées dans Supabase...</p>
              </div>
            ) : linkedCounts && linkedCounts.total > 0 ? (
              /* Scenario A: School HAS linked records -> Hard delete blocked, recommendation to Archive */
              <div className="p-4 bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl space-y-3">
                <h4 className="font-extrabold text-amber-200 text-xs uppercase flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span>Suppression Définitive Bloquée par Sécurité</span>
                </h4>
                <p className="text-slate-300 leading-relaxed">
                  Cet établissement contient encore <strong className="text-white">{linkedCounts.total} élément(s) rattaché(s)</strong> dans Supabase :
                  <span className="block mt-1 text-slate-400 font-mono text-[11px]">
                    • {linkedCounts.profiles} profil(s) utilisateur(s)<br />
                    • {linkedCounts.classes} classe(s)<br />
                    • {linkedCounts.students} dossier(s) élève(s)<br />
                    • {linkedCounts.years} année(s) scolaire(s)
                  </span>
                  Pour préserver l'historique et l'intégrité de la base de données, la suppression directe est refusée. Nous vous recommandons d'<strong>Archiver</strong> cet établissement.
                </p>

                {deleteError && (
                  <div className="p-2.5 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-200 text-xs">
                    {deleteError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeletingSchool(null)}
                    className="px-4 py-2 font-bold text-slate-300 hover:text-white"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => handleArchiveSchool(deletingSchool)}
                    className="px-5 py-2 font-extrabold bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-300 rounded-xl shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <Archive className="w-4 h-4" />
                    <span>{isDeleting ? 'Archivage...' : 'Archiver l’Établissement (Recommandé)'}</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Scenario B: School is EMPTY -> Require exact name entry */
              <div className="space-y-4">
                <div className="p-4 bg-slate-950 border-2 border-slate-700 rounded-2xl space-y-2">
                  <p className="text-slate-300 leading-relaxed">
                    Cet établissement est totalement vide (0 profil, 0 classe). Pour confirmer sa suppression définitive de Supabase, veuillez saisir exactement son nom ci-dessous :
                  </p>
                  <p className="font-extrabold text-rose-400 text-sm select-all">{deletingSchool.name}</p>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                    Saisir le nom exact de l'école *
                  </label>
                  <input
                    type="text"
                    placeholder={deletingSchool.name}
                    value={formConfirmDeleteName}
                    onChange={e => setFormConfirmDeleteName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-rose-500/60 rounded-xl text-sm font-bold text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                  />
                </div>

                {deleteError && (
                  <div className="p-3 bg-rose-500/20 border-2 border-rose-500/40 rounded-xl text-rose-200 text-xs font-semibold">
                    {deleteError}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setDeletingSchool(null)}
                    className="px-4 py-2 font-bold text-slate-300 hover:text-white"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => handleArchiveSchool(deletingSchool)}
                    className="px-4 py-2 font-bold bg-slate-800 hover:bg-slate-700 border border-slate-600 text-amber-300 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archiver au lieu de supprimer</span>
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting || formConfirmDeleteName.trim() !== deletingSchool.name.trim()}
                    onClick={() => handleExecuteHardDelete(deletingSchool)}
                    className="px-5 py-2 font-extrabold bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white rounded-xl shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isDeleting ? 'Suppression...' : 'Supprimer Définitivement'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Footer */}
      <footer className="p-4 sm:p-6 border-t border-slate-900 text-center text-xs text-slate-500">
        ÉcoleConnect — Console d'Administration Globale PaTShi-Digital
      </footer>
    </div>
  );
};
