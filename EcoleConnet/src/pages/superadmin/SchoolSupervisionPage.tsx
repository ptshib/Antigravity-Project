import React, { useState, useEffect, useCallback } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import { Modal } from '../../components/common/Modal';
import {
  ArrowLeft,
  Users,
  ShieldCheck,
  Calendar,
  Layers,
  BookOpen,
  UserCheck,
  Settings,
  Plus,
  AlertCircle,
  Lock,
  Edit,
  Ban,
  Clock,
  FileText,
  Activity,
  Search,
  GraduationCap,
  Eye,
  Trash2,
  Power,
  CheckCircle2,
  XCircle,
  Send,
  CalendarDays,
  Unlock
} from 'lucide-react';

interface SchoolDetail {
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
  suspension_reason?: string | null;
  suspended_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface AcademicYearRow {
  id: string;
  school_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
  created_at: string;
}

interface SchoolTermRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  name: string;
  position: number;
  education_cycle?: 'primary' | 'secondary' | null;
  division_type?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  created_at: string;
}

interface SchoolPeriodRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  parent_term_id: string;
  name: string;
  position: number;
  position_within_parent: number;
  education_cycle: 'primary' | 'secondary';
  starts_on?: string | null;
  ends_on?: string | null;
  created_at: string;
}

interface ClassRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  name: string;
  level?: string | null;
  section?: string | null;
  room?: string | null;
  homeroom_teacher_id?: string | null;
  is_active: boolean;
  created_at: string;
}

interface ProfileRow {
  id: string;
  school_id: string;
  role: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  avatar_url?: string | null;
  is_active: boolean;
  created_at: string;
}

interface AuditLogRow {
  id: string;
  school_id: string;
  action: string;
  details: any;
  created_at: string;
}

interface SchoolSupervisionPageProps {
  schoolId: string;
  onBack: () => void;
}

type TabType =
  | 'vue_densemble'
  | 'configuration'
  | 'administrateurs'
  | 'annees_scolaires'
  | 'calendrier_scolaire'
  | 'classes'
  | 'enseignants'
  | 'parents'
  | 'eleves'
  | 'affectations'
  | 'modules'
  | 'securite'
  | 'audit';

export const SchoolSupervisionPage: React.FC<SchoolSupervisionPageProps> = ({
  schoolId,
  onBack
}) => {
  const { profile } = useRealAuth();
  const { showToast } = useNotifications();

  // Active Tab
  const [activeTab, setActiveTab] = useState<TabType>('vue_densemble');

  // Main Data States
  const [school, setSchool] = useState<SchoolDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sub-data States
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [schoolTerms, setSchoolTerms] = useState<SchoolTermRow[]>([]);
  const [schoolPeriods, setSchoolPeriods] = useState<SchoolPeriodRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [searchUser, setSearchUser] = useState<string>('');

  // Modals States
  const [showEditSchoolModal, setShowEditSchoolModal] = useState(false);
  const [showEditCyclesModal, setShowEditCyclesModal] = useState(false);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [showCreateAdminModal, setShowCreateAdminModal] = useState(false);
  const [showCreateYearModal, setShowCreateYearModal] = useState(false);
  const [showCreateTermModal, setShowCreateTermModal] = useState(false);
  const [showCreateClassModal, setShowCreateClassModal] = useState(false);

  // Edit Cycles State
  const [editSelectedCycles, setEditSelectedCycles] = useState<'primary' | 'secondary' | 'both'>('both');
  const [savingCycles, setSavingCycles] = useState(false);

  // Form States - Edit School
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWhatsapp, setEditWhatsapp] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editTimezone, setEditTimezone] = useState('');
  const [editStatus, setEditStatus] = useState<'active' | 'suspended' | 'archived'>('active');
  const [savingConfig, setSavingConfig] = useState(false);

  // Form States - Suspension
  const [suspensionReasonInput, setSuspensionReasonInput] = useState('');

  // Form States - Create Admin
  const [adminFirstName, setAdminFirstName] = useState('');
  const [adminLastName, setAdminLastName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  // Admin Actions States
  const [selectedAdmin, setSelectedAdmin] = useState<ProfileRow | null>(null);
  const [showAdminDetailsModal, setShowAdminDetailsModal] = useState(false);

  // Edit Admin States
  const [showEditAdminModal, setShowEditAdminModal] = useState(false);
  const [editAdminFirstName, setEditAdminFirstName] = useState('');
  const [editAdminLastName, setEditAdminLastName] = useState('');
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [editAdminPhone, setEditAdminPhone] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [editAdminErrorMsg, setEditAdminErrorMsg] = useState<string | null>(null);

  // Delete Admin States
  const [showDeleteAdminModal, setShowDeleteAdminModal] = useState(false);
  const [deleteAdminConfirmName, setDeleteAdminConfirmName] = useState('');
  const [deletingAdmin, setDeletingAdmin] = useState(false);
  const [deleteAdminErrorMsg, setDeleteAdminErrorMsg] = useState<string | null>(null);

  // Form States - Create Year
  const [yearName, setYearName] = useState('2026–2027');
  const [yearStartsOn, setYearStartsOn] = useState('2026-09-01');
  const [yearEndsOn, setYearEndsOn] = useState('2027-07-02');
  const [yearIsCurrent, setYearIsCurrent] = useState(true);

  // Form States - Create Term
  const [termName, setTermName] = useState('1er Trimestre');
  const [termPosition, setTermPosition] = useState(1);
  const [termYearId, setTermYearId] = useState('');
  const [termStartsOn, setTermStartsOn] = useState('');
  const [termEndsOn, setTermEndsOn] = useState('');

  // Form States - Create Class
  const [className, setClassName] = useState('');
  const [classLevel, setClassLevel] = useState('7ème EB');
  const [classSection, setClassSection] = useState('A');
  const [classRoom, setClassRoom] = useState('S1');
  const [classYearId, setClassYearId] = useState('');
  const [classTeacherId, setClassTeacherId] = useState('');

  // School Calendars Status & Dates Management (Super Admin)
  const [schoolCalendars, setSchoolCalendars] = useState<any[]>([]);
  const [showEditTermModal, setShowEditTermModal] = useState(false);
  const [selectedTermForDates, setSelectedTermForDates] = useState<any | null>(null);
  const [termStartInput, setTermStartInput] = useState('');
  const [termEndInput, setTermEndInput] = useState('');
  const [savingTermDates, setSavingTermDates] = useState(false);

  const [showEditPeriodModal, setShowEditPeriodModal] = useState(false);
  const [selectedPeriodForDates, setSelectedPeriodForDates] = useState<any | null>(null);
  const [periodStartInput, setPeriodStartInput] = useState('');
  const [periodEndInput, setPeriodEndInput] = useState('');
  const [savingPeriodDates, setSavingPeriodDates] = useState(false);

  const [showConfigErrorsModal, setShowConfigErrorsModal] = useState(false);
  const [configErrorsCycle, setConfigErrorsCycle] = useState<'primary' | 'secondary'>('primary');
  const [activatingCalendarCycle, setActivatingCalendarCycle] = useState<'primary' | 'secondary' | null>(null);

  const [showReopenCalendarModal, setShowReopenCalendarModal] = useState(false);
  const [reopenCalendarCycle, setReopenCalendarCycle] = useState<'primary' | 'secondary'>('primary');
  const [reopenReasonInput, setReopenReasonInput] = useState('');
  const [reopeningCalendar, setReopeningCalendar] = useState(false);

  // Fetch All School Data
  const loadSchoolData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch School Detail
      const { data: schoolData, error: schoolErr } = await supabase
        .from('schools')
        .select('*')
        .eq('id', schoolId)
        .single();

      if (schoolErr || !schoolData) {
        throw new Error('Établissement introuvable dans la base de données Supabase.');
      }

      setSchool(schoolData as SchoolDetail);
      setEditName(schoolData.name);
      setEditSlug(schoolData.slug);
      setEditLogoUrl(schoolData.logo_url || '');
      setEditPhone(schoolData.phone || '');
      setEditWhatsapp(schoolData.whatsapp || '');
      setEditEmail(schoolData.email || '');
      setEditAddress(schoolData.address || '');
      setEditCountry(schoolData.country || 'RD Congo');
      setEditTimezone(schoolData.timezone || 'Africa/Kinshasa');
      setEditStatus(schoolData.status);

      // 2. Fetch Academic Years
      const { data: yearsData } = await supabase
        .from('academic_years')
        .select('*')
        .eq('school_id', schoolId)
        .order('starts_on', { ascending: false });
      setAcademicYears(yearsData || []);
      if (yearsData && yearsData.length > 0) {
        setTermYearId(yearsData[0].id);
        setClassYearId(yearsData[0].id);
      }

      // 3. Fetch School Terms & Periods
      const { data: termsData } = await supabase
        .from('school_terms')
        .select('*')
        .eq('school_id', schoolId)
        .order('position', { ascending: true });
      setSchoolTerms(termsData || []);

      const { data: periodsData } = await supabase
        .from('school_periods')
        .select('*')
        .eq('school_id', schoolId)
        .order('position', { ascending: true });
      setSchoolPeriods(periodsData || []);

      // 3b. Fetch School Calendars
      const { data: calendarsData } = await supabase
        .from('school_calendars')
        .select('*')
        .eq('school_id', schoolId);
      setSchoolCalendars(calendarsData || []);

      // 4. Fetch Classes
      const { data: classesData } = await supabase
        .from('classes')
        .select('*')
        .eq('school_id', schoolId)
        .order('name', { ascending: true });
      setClasses(classesData || []);

      // 5. Fetch Profiles (Users)
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('*')
        .eq('school_id', schoolId)
        .order('last_name', { ascending: true });
      setProfiles(profilesData || []);

      // 6. Fetch Audit Logs
      const { data: auditData } = await supabase
        .from('school_audit_logs')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false });
      setAuditLogs(auditData || []);

    } catch (err: any) {
      console.error('Error loading school supervision:', err);
      setErrorMsg(err.message || 'Impossible de charger l’établissement.');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadSchoolData();
  }, [loadSchoolData]);

  // Handlers
  const handleSaveConfiguration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school) return;

    setSavingConfig(true);
    try {
      const cleanSlug = editSlug.trim().toLowerCase();
      if (!cleanSlug) {
        throw new Error("L'identifiant slug est obligatoire.");
      }

      // Check slug uniqueness if changed
      if (cleanSlug !== school.slug) {
        const { data: existing } = await supabase
          .from('schools')
          .select('id')
          .eq('slug', cleanSlug)
          .maybeSingle();
        if (existing) {
          throw new Error(`Le slug "${cleanSlug}" est déjà utilisé.`);
        }
      }

      const { error: updateErr } = await supabase
        .from('schools')
        .update({
          name: editName.trim(),
          slug: cleanSlug,
          logo_url: editLogoUrl.trim() || null,
          phone: editPhone.trim() || null,
          whatsapp: editWhatsapp.trim() || null,
          email: editEmail.trim() || null,
          address: editAddress.trim() || null,
          country: editCountry.trim() || 'RD Congo',
          timezone: editTimezone.trim() || 'Africa/Kinshasa',
          status: editStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', schoolId);

      if (updateErr) throw updateErr;

      // Audit log
      await supabase.from('school_audit_logs').insert({
        school_id: schoolId,
        actor_id: profile?.id || null,
        action: 'school_configuration_updated',
        details: { name: editName, slug: cleanSlug, status: editStatus }
      });

      showToast('Configuration de l’établissement mise à jour avec succès !', 'success');
      setShowEditSchoolModal(false);
      loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la mise à jour.', 'warning');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleConfirmSuspension = async () => {
    if (!school) return;
    const newStatus = school.status === 'active' ? 'suspended' : 'active';
    try {
      const { error } = await supabase
        .from('schools')
        .update({
          status: newStatus,
          suspension_reason: newStatus === 'suspended' ? (suspensionReasonInput.trim() || 'Motif administratif') : null,
          suspended_at: newStatus === 'suspended' ? new Date().toISOString() : null,
          suspended_by: newStatus === 'suspended' ? profile?.id : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', schoolId);

      if (error) throw error;

      await supabase.from('school_audit_logs').insert({
        school_id: schoolId,
        actor_id: profile?.id || null,
        action: newStatus === 'suspended' ? 'school_suspended' : 'school_reactivated',
        details: { reason: suspensionReasonInput }
      });

      showToast(`Établissement ${newStatus === 'suspended' ? 'suspendu' : 'réactivé'} avec succès.`, 'info');
      setShowSuspendModal(false);
      setSuspensionReasonInput('');
      loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du changement de statut.', 'warning');
    }
  };

  const [adminErrorMsg, setAdminErrorMsg] = useState<string | null>(null);

  const handleCreateSchoolAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminErrorMsg(null);

    if (!adminEmail.trim() || !adminFirstName.trim() || !adminLastName.trim()) {
      setAdminErrorMsg('Veuillez remplir tous les champs obligatoires.');
      return;
    }

    setCreatingAdmin(true);
    try {
      // SÉCURITÉ STRICTE : La création de l'administrateur s'effectue EXCLUSIVEMENT
      // par l'Edge Function serveur create-school-admin. Aucun fallback client.
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke('create-school-admin', {
        body: {
          school_id: schoolId,
          email: adminEmail.trim(),
          first_name: adminFirstName.trim(),
          last_name: adminLastName.trim(),
          phone: adminPhone.trim() || null
        }
      });

      if (edgeErr) {
        let msg = edgeErr.message || "Erreur lors de l'exécution du service.";
        if (
          edgeErr.status === 404 ||
          msg.includes('Failed to send a request') ||
          msg.includes('FunctionsFetchError') ||
          msg.includes('not found')
        ) {
          msg = "Le service sécurisé de création des comptes administrateurs n’est pas encore disponible. Veuillez déployer la fonction create-school-admin.";
        }
        setAdminErrorMsg(msg);
        showToast(msg, 'warning');
        return;
      }

      if (edgeData?.error) {
        setAdminErrorMsg(edgeData.error);
        showToast(edgeData.error, 'warning');
        return;
      }

      showToast(`Administrateur ${adminFirstName} ${adminLastName} créé avec succès !`, 'success');
      setShowCreateAdminModal(false);
      setAdminFirstName('');
      setAdminLastName('');
      setAdminEmail('');
      setAdminPhone('');
      setAdminErrorMsg(null);
      loadSchoolData();
    } catch (err: any) {
      const msg = err.message || "Le service sécurisé de création des comptes administrateurs n’est pas encore disponible. Veuillez déployer la fonction create-school-admin.";
      setAdminErrorMsg(msg);
      showToast(msg, 'warning');
    } finally {
      setCreatingAdmin(false);
    }
  };

  const openEditAdminModal = (admin: ProfileRow) => {
    setSelectedAdmin(admin);
    setEditAdminFirstName(admin.first_name);
    setEditAdminLastName(admin.last_name);
    setEditAdminPhone(admin.phone || '');
    setEditAdminEmail('');
    setEditAdminErrorMsg(null);
    setShowEditAdminModal(true);
  };

  const handleToggleAdminActive = async (admin: ProfileRow) => {
    const newActive = !admin.is_active;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: newActive, updated_at: new Date().toISOString() })
        .eq('id', admin.id);

      if (error) throw error;

      await supabase.from('school_audit_logs').insert({
        school_id: schoolId,
        actor_id: profile?.id || null,
        action: newActive ? 'school_admin_reactivated' : 'school_admin_deactivated',
        details: { admin_id: admin.id, name: `${admin.first_name} ${admin.last_name}` }
      });

      showToast(`Compte administrateur ${admin.first_name} ${admin.last_name} ${newActive ? 'réactivé' : 'désactivé'} avec succès.`, 'info');
      loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la modification du statut.', 'warning');
    }
  };

  const handleSaveEditAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmin) return;
    setEditAdminErrorMsg(null);
    setSavingAdmin(true);

    try {
      const { data, error } = await supabase.functions.invoke('manage-school-admin', {
        body: {
          action: 'update_admin',
          school_id: schoolId,
          admin_id: selectedAdmin.id,
          first_name: editAdminFirstName.trim(),
          last_name: editAdminLastName.trim(),
          phone: editAdminPhone.trim() || null,
          email: editAdminEmail.trim() || undefined
        }
      });

      if (error) {
        throw new Error(error.message || 'Erreur lors de la mise à jour.');
      }

      if (data?.error) {
        setEditAdminErrorMsg(data.error);
        return;
      }

      showToast(`Compte administrateur mis à jour avec succès !`, 'success');
      setShowEditAdminModal(false);
      loadSchoolData();
    } catch (err: any) {
      setEditAdminErrorMsg(err.message || 'Erreur lors de la modification.');
    } finally {
      setSavingAdmin(false);
    }
  };

  const openDeleteAdminModal = (admin: ProfileRow) => {
    setSelectedAdmin(admin);
    setDeleteAdminConfirmName('');
    setDeleteAdminErrorMsg(null);
    setShowDeleteAdminModal(true);
  };

  const handleConfirmDeleteAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmin) return;

    const fullName = `${selectedAdmin.first_name} ${selectedAdmin.last_name}`.trim();
    if (deleteAdminConfirmName.trim() !== fullName) {
      setDeleteAdminErrorMsg(`Veuillez saisir exactement "${fullName}" pour confirmer.`);
      return;
    }

    setDeletingAdmin(true);
    setDeleteAdminErrorMsg(null);

    try {
      const { data, error } = await supabase.functions.invoke('manage-school-admin', {
        body: {
          action: 'delete_admin',
          school_id: schoolId,
          admin_id: selectedAdmin.id
        }
      });

      if (error) {
        throw new Error(error.message || 'Erreur lors de la suppression.');
      }

      if (data?.error) {
        setDeleteAdminErrorMsg(data.error);
        return;
      }

      showToast(`Administrateur ${fullName} supprimé définitivement avec succès.`, 'info');
      setShowDeleteAdminModal(false);
      loadSchoolData();
    } catch (err: any) {
      setDeleteAdminErrorMsg(err.message || 'Erreur lors de la suppression.');
    } finally {
      setDeletingAdmin(false);
    }
  };

  // Helper Validation Functions (Super Admin)
  const validateTermDateInputs = (startsOn: string, endsOn: string, cycle: string, currentTermId?: string) => {
    if (!startsOn || !endsOn) return null;
    if (startsOn > endsOn) return 'La date de début doit être antérieure ou égale à la date de fin.';
    if (currentYear?.starts_on && startsOn < currentYear.starts_on) {
      return `La date de début (${startsOn}) ne peut pas être antérieure au début de l'année scolaire (${currentYear.starts_on}).`;
    }
    if (currentYear?.ends_on && endsOn > currentYear.ends_on) {
      return `La date de fin (${endsOn}) ne peut pas dépasser la fin de l'année scolaire (${currentYear.ends_on}).`;
    }
    const siblings = schoolTerms.filter(t => t.education_cycle === cycle && t.id !== currentTermId && t.starts_on && t.ends_on);
    for (const s of siblings) {
      if (startsOn <= s.ends_on! && endsOn >= s.starts_on!) {
        return `Chevauchement avec le terme "${s.name}" (${s.starts_on} au ${s.ends_on}).`;
      }
    }
    return null;
  };

  const validatePeriodDateInputs = (startsOn: string, endsOn: string, parentTermId: string, currentPeriodId?: string) => {
    if (!startsOn || !endsOn) return null;
    if (startsOn > endsOn) return 'La date de début doit être antérieure ou égale à la date de fin.';
    const parent = schoolTerms.find(t => t.id === parentTermId);
    if (parent) {
      if (parent.starts_on && startsOn < parent.starts_on) {
        return `La date de début (${startsOn}) ne peut pas être antérieure au début du terme parent "${parent.name}" (${parent.starts_on}).`;
      }
      if (parent.ends_on && endsOn > parent.ends_on) {
        return `La date de fin (${endsOn}) ne peut pas dépasser la fin du terme parent "${parent.name}" (${parent.ends_on}).`;
      }
    }
    if (currentYear?.starts_on && startsOn < currentYear.starts_on) {
      return `La date de début (${startsOn}) ne peut pas être antérieure au début de l'année scolaire (${currentYear.starts_on}).`;
    }
    if (currentYear?.ends_on && endsOn > currentYear.ends_on) {
      return `La date de fin (${endsOn}) ne peut pas dépasser la fin de l'année scolaire (${currentYear.ends_on}).`;
    }
    const siblings = schoolPeriods.filter(p => p.parent_term_id === parentTermId && p.id !== currentPeriodId && p.starts_on && p.ends_on);
    for (const s of siblings) {
      if (startsOn <= s.ends_on! && endsOn >= s.starts_on!) {
        return `Chevauchement avec la période "${s.name}" (${s.starts_on} au ${s.ends_on}).`;
      }
    }
    return null;
  };

  const getCycleValidationErrors = (cycle: 'primary' | 'secondary') => {
    const errors: string[] = [];
    const expectedTerms = cycle === 'primary' ? 3 : 2;
    const expectedPeriods = cycle === 'primary' ? 9 : 4;
    const terms = schoolTerms.filter(t => t.education_cycle === cycle).sort((a, b) => a.position - b.position);
    const periods = schoolPeriods.filter(p => p.education_cycle === cycle).sort((a, b) => a.position - b.position);

    if (terms.length !== expectedTerms) {
      errors.push(`Structure incomplète : ${expectedTerms} termes requis (${terms.length} configurés).`);
    }
    if (periods.length !== expectedPeriods) {
      errors.push(`Structure incomplète : ${expectedPeriods} périodes requises (${periods.length} configurées).`);
    }

    const missingTermDates = terms.filter(t => !t.starts_on || !t.ends_on);
    if (missingTermDates.length > 0) {
      errors.push(`Dates manquantes sur ${missingTermDates.length} terme(s) (${missingTermDates.map(t => t.name).join(', ')}).`);
    }

    const missingPeriodDates = periods.filter(p => !p.starts_on || !p.ends_on);
    if (missingPeriodDates.length > 0) {
      errors.push(`Dates manquantes sur ${missingPeriodDates.length} période(s) (${missingPeriodDates.map(p => p.name).join(', ')}).`);
    }

    periods.forEach(p => {
      const parent = terms.find(t => t.id === p.parent_term_id);
      if (parent && p.starts_on && p.ends_on && parent.starts_on && parent.ends_on) {
        if (p.starts_on < parent.starts_on || p.ends_on > parent.ends_on) {
          errors.push(`La période "${p.name}" (${p.starts_on} – ${p.ends_on}) déborde de son terme parent "${parent.name}" (${parent.starts_on} – ${parent.ends_on}).`);
        }
      }
    });

    return errors;
  };

  // Handlers Super Admin - Sauvegarde dates
  const handleSaveTermDates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTermForDates) return;
    const err = validateTermDateInputs(termStartInput, termEndInput, selectedTermForDates.education_cycle, selectedTermForDates.id);
    if (err) {
      showToast(err, 'warning');
      return;
    }
    setSavingTermDates(true);
    try {
      const { error } = await supabase.rpc('save_school_term_dates', {
        p_term_id: selectedTermForDates.id,
        p_starts_on: termStartInput || null,
        p_ends_on: termEndInput || null
      });
      if (error) throw error;
      showToast(`Dates du terme "${selectedTermForDates.name}" enregistrées !`, 'success');
      setShowEditTermModal(false);
      await loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’enregistrement des dates du terme.', 'warning');
    } finally {
      setSavingTermDates(false);
    }
  };

  const handleSavePeriodDates = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeriodForDates) return;
    const err = validatePeriodDateInputs(periodStartInput, periodEndInput, selectedPeriodForDates.parent_term_id, selectedPeriodForDates.id);
    if (err) {
      showToast(err, 'warning');
      return;
    }
    setSavingPeriodDates(true);
    try {
      const { error } = await supabase.rpc('save_school_period_dates', {
        p_period_id: selectedPeriodForDates.id,
        p_starts_on: periodStartInput || null,
        p_ends_on: periodEndInput || null
      });
      if (error) throw error;
      showToast(`Dates de la période "${selectedPeriodForDates.name}" enregistrées !`, 'success');
      setShowEditPeriodModal(false);
      await loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’enregistrement des dates de la période.', 'warning');
    } finally {
      setSavingPeriodDates(false);
    }
  };

  const handleActivateCalendar = async (cycle: 'primary' | 'secondary') => {
    if (!school?.id || !currentYear?.id) return;
    const errs = getCycleValidationErrors(cycle);
    if (errs.length > 0) {
      setConfigErrorsCycle(cycle);
      setShowConfigErrorsModal(true);
      return;
    }
    setActivatingCalendarCycle(cycle);
    try {
      const { error } = await supabase.rpc('activate_school_calendar', {
        p_school_id: school.id,
        p_academic_year_id: currentYear.id,
        p_education_cycle: cycle
      });
      if (error) throw error;
      showToast(`Calendrier Scolaire pour le cycle ${cycle === 'primary' ? 'Primaire' : 'Secondaire'} activé avec succès !`, 'success');
      await loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’activation du calendrier.', 'warning');
    } finally {
      setActivatingCalendarCycle(null);
    }
  };

  const handleOpenReopenModal = (cycle: 'primary' | 'secondary') => {
    setReopenCalendarCycle(cycle);
    setReopenReasonInput('');
    setShowReopenCalendarModal(true);
  };

  const handleConfirmReopenCalendar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !currentYear?.id) return;
    if (reopenReasonInput.trim().length < 5) {
      showToast('Le motif de réouverture doit comporter au moins 5 caractères.', 'warning');
      return;
    }
    setReopeningCalendar(true);
    try {
      const { error } = await supabase.rpc('reopen_school_calendar', {
        p_school_id: school.id,
        p_academic_year_id: currentYear.id,
        p_education_cycle: reopenCalendarCycle,
        p_reason: reopenReasonInput.trim()
      });
      if (error) throw error;
      showToast(`Calendrier Scolaire (${reopenCalendarCycle === 'primary' ? 'Primaire' : 'Secondaire'}) rouvert en brouillon.`, 'success');
      setShowReopenCalendarModal(false);
      setReopenReasonInput('');
      await loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la réouverture du calendrier.', 'warning');
    } finally {
      setReopeningCalendar(false);
    }
  };

  const handleCloseCalendar = async (cycle: 'primary' | 'secondary') => {
    if (!school?.id || !currentYear?.id) return;
    try {
      const { error } = await supabase.rpc('close_school_calendar', {
        p_school_id: school.id,
        p_academic_year_id: currentYear.id,
        p_education_cycle: cycle
      });
      if (error) throw error;
      showToast(`Calendrier Scolaire (${cycle === 'primary' ? 'Primaire' : 'Secondaire'}) clôturé.`, 'success');
      await loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la clôture du calendrier.', 'warning');
    }
  };

  const handleResendInvitation = async (admin: ProfileRow) => {
    try {
      const { data, error } = await supabase.functions.invoke('manage-school-admin', {
        body: {
          action: 'resend_invitation',
          school_id: schoolId,
          admin_id: admin.id
        }
      });

      if (error) throw error;
      if (data?.error) {
        showToast(data.error, 'warning');
        return;
      }

      showToast(`L'invitation d'activation a été renvoyée avec succès à ${admin.first_name} ${admin.last_name}.`, 'success');
    } catch (err: any) {
      showToast(err.message || "Erreur lors du renvoi de l'invitation.", 'warning');
    }
  };

  const handleCreateAcademicYear = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // If setting is_current = true, un-set other current years first
      if (yearIsCurrent) {
        await supabase
          .from('academic_years')
          .update({ is_current: false })
          .eq('school_id', schoolId);
      }

      const { error } = await supabase.from('academic_years').insert({
        school_id: schoolId,
        name: yearName.trim(),
        starts_on: yearStartsOn,
        ends_on: yearEndsOn,
        is_current: yearIsCurrent
      });

      if (error) throw error;

      showToast(`Année scolaire "${yearName}" créée avec succès !`, 'success');
      setShowCreateYearModal(false);
      loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de l’année scolaire.', 'warning');
    }
  };

  const handleCreateSchoolTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termYearId) {
      showToast('Veuillez d’abord créer une année scolaire.', 'warning');
      return;
    }

    try {
      const { error } = await supabase.from('school_terms').insert({
        school_id: schoolId,
        academic_year_id: termYearId,
        name: termName.trim(),
        position: termPosition,
        starts_on: termStartsOn || null,
        ends_on: termEndsOn || null
      });

      if (error) throw error;

      showToast(`Trimestre "${termName}" enregistré avec succès !`, 'success');
      setShowCreateTermModal(false);
      loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création du trimestre.', 'warning');
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim() || !classYearId) {
      showToast('Le nom de la classe et l’année scolaire sont obligatoires.', 'warning');
      return;
    }

    try {
      const { error } = await supabase.from('classes').insert({
        school_id: schoolId,
        academic_year_id: classYearId,
        name: className.trim(),
        level: classLevel,
        section: classSection,
        room: classRoom,
        homeroom_teacher_id: classTeacherId || null,
        is_active: true
      });

      if (error) throw error;

      showToast(`Classe "${className}" créée avec succès !`, 'success');
      setShowCreateClassModal(false);
      setClassName('');
      loadSchoolData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de la classe.', 'warning');
    }
  };

  // Metric counts
  const admins = profiles.filter(p => p.role === 'school_admin');
  const teachers = profiles.filter(p => p.role === 'teacher');
  const parents = profiles.filter(p => p.role === 'parent');
  const students = profiles.filter(p => p.role === 'student');
  const currentYear = academicYears.find(y => y.is_current);

  // Loading Screen
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-rose-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement de la console d'établissement...</p>
      </div>
    );
  }

  // 404 Invalid School Screen
  if (errorMsg || !school) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between p-6">
        <div className="max-w-md w-full mx-auto my-auto bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 rounded-3xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
            <AlertCircle className="w-9 h-9" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-extrabold">Établissement Introuvable</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {errorMsg || "L'identifiant d'école fourni ne correspond à aucun établissement dans Supabase."}
            </p>
          </div>
          <button
            onClick={onBack}
            className="w-full py-3 bg-rose-600 hover:bg-rose-700 font-extrabold text-xs rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Retourner au Registre des Écoles</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-rose-500 selection:text-white">
      {/* Top Header Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer border border-slate-700 shrink-0"
            title="Retour au Registre des Écoles"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
              <span className="cursor-pointer hover:text-white" onClick={onBack}>Super-Admin</span>
              <span>/</span>
              <span className="cursor-pointer hover:text-white" onClick={onBack}>Registre</span>
              <span>/</span>
              <span className="text-rose-400 font-mono">{school.slug}</span>
            </div>
            <h1 className="text-lg font-black text-white flex items-center gap-2 mt-0.5">
              <span>{school.name}</span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                  school.status === 'active'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}
              >
                {school.status === 'active' ? 'Actif' : 'Suspendu'}
              </span>
            </h1>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowEditSchoolModal(true)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Edit className="w-3.5 h-3.5 text-slate-400" />
            <span>Modifier</span>
          </button>

          <button
            onClick={() => setShowCreateAdminModal(true)}
            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold rounded-xl shadow-md transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nouvel Admin</span>
          </button>

          <button
            onClick={() => setShowSuspendModal(true)}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl border transition-colors cursor-pointer flex items-center gap-1.5 ${
              school.status === 'active'
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
            }`}
          >
            <Ban className="w-3.5 h-3.5" />
            <span>{school.status === 'active' ? 'Suspendre' : 'Réactiver'}</span>
          </button>
        </div>
      </header>

      {/* Secondary Navigation Tabs */}
      <nav className="bg-slate-900/80 border-b border-slate-800 px-4 sm:px-6 py-2 overflow-x-auto scrollbar-none flex items-center gap-1 text-xs">
        {[
          { id: 'vue_densemble', label: 'Vue d’ensemble', icon: Activity },
          { id: 'configuration', label: 'Configuration', icon: Settings },
          { id: 'administrateurs', label: `Admins (${admins.length})`, icon: ShieldCheck },
          { id: 'annees_scolaires', label: `Années (${academicYears.length})`, icon: Calendar },
          { id: 'calendrier_scolaire', label: `Calendrier Scolaire (${schoolTerms.length})`, icon: Clock },
          { id: 'classes', label: `Classes (${classes.length})`, icon: BookOpen },
          { id: 'enseignants', label: `Enseignants (${teachers.length})`, icon: UserCheck },
          { id: 'parents', label: `Parents (${parents.length})`, icon: Users },
          { id: 'eleves', label: `Élèves (${students.length})`, icon: GraduationCap },
          { id: 'modules', label: 'Modules', icon: Layers },
          { id: 'securite', label: 'Sécurité', icon: Lock },
          { id: 'audit', label: 'Journal d’activité', icon: FileText }
        ].map(tab => {
          const IconComp = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-3.5 py-2 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-rose-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <IconComp className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Main Supervision Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-8">
        {/* TAB 1: VUE D'ENSEMBLE */}
        {activeTab === 'vue_densemble' && (
          <div className="space-y-6">
            {/* Suspended Notice Banner */}
            {school.status === 'suspended' && (
              <div className="p-4 bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl flex items-start gap-3 text-amber-300 text-xs">
                <Ban className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-extrabold text-amber-200">Établissement actuellement suspendu</h4>
                  <p className="mt-0.5 leading-relaxed">
                    Motif : {school.suspension_reason || 'Raison administrative'}. L'accès des utilisateurs de cette école est temporairement bloqué.
                  </p>
                </div>
              </div>
            )}

            {/* Zero Admin Warning Banner */}
            {admins.length === 0 && (
              <div className="p-5 bg-rose-950/40 border-2 border-rose-500/50 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-extrabold text-rose-200 text-sm">0 Compte Administrateur Rattaché</h4>
                    <p className="text-slate-300 mt-0.5 leading-relaxed">
                      Pour mettre cet établissement en service et lui accorder l'accès à la plateforme, créez son administrateur principal (<code>school_admin</code>).
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateAdminModal(true)}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-xl shadow-lg cursor-pointer shrink-0 flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Créer le premier administrateur</span>
                </button>
              </div>
            )}

            {/* Metrics Grid */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div 
                onClick={() => setActiveTab('administrateurs')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('administrateurs');
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label="Voir la liste des administrateurs d'école"
                className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1 cursor-pointer hover:border-rose-500/50 hover:bg-slate-800/80 transition-all group focus:outline-none focus:ring-2 focus:ring-rose-500/50"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-400 uppercase group-hover:text-rose-300 transition-colors">Administrateurs d'École</p>
                  <Users className="w-4 h-4 text-slate-500 group-hover:text-rose-400 transition-colors" />
                </div>
                <p className="text-2xl font-black text-rose-400">{admins.length} Compte(s)</p>
                <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors flex items-center gap-1">
                  <span>Gestionnaires de l'établissement</span>
                  <span className="font-bold text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </p>
              </div>

              <div 
                onClick={() => setActiveTab('enseignants')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('enseignants');
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label="Voir la liste des enseignants rattachés"
                className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1 cursor-pointer hover:border-emerald-500/50 hover:bg-slate-800/80 transition-all group focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-400 uppercase group-hover:text-emerald-300 transition-colors">Enseignants Rattachés</p>
                  <UserCheck className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                </div>
                <p className="text-2xl font-black text-white">{teachers.length} Professeur(s)</p>
                <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors flex items-center gap-1">
                  <span>Personnel enseignant actif</span>
                  <span className="font-bold text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </p>
              </div>

              <div 
                onClick={() => setActiveTab('eleves')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('eleves');
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label="Voir la liste des élèves enregistrés"
                className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1 cursor-pointer hover:border-cyan-500/50 hover:bg-slate-800/80 transition-all group focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-400 uppercase group-hover:text-cyan-300 transition-colors">Élèves Enregistrés</p>
                  <GraduationCap className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transition-colors" />
                </div>
                <p className="text-2xl font-black text-white">{students.length} Élève(s)</p>
                <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors flex items-center gap-1">
                  <span>Dossiers scolaires actifs</span>
                  <span className="font-bold text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </p>
              </div>

              <div 
                onClick={() => setActiveTab('annees_scolaires')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('annees_scolaires');
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label="Gérer les années scolaires"
                className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1 cursor-pointer hover:border-indigo-500/50 hover:bg-slate-800/80 transition-all group focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-400 uppercase group-hover:text-indigo-300 transition-colors">Année Scolaire Courante</p>
                  <Calendar className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                </div>
                <p className="text-2xl font-black text-emerald-400">{currentYear ? currentYear.name : 'Non définie'}</p>
                <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors flex items-center gap-1">
                  <span>{classes.length} Classe(s) configurée(s)</span>
                  <span className="font-bold text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </p>
              </div>
            </div>

            {/* School Profile Card */}
            <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-extrabold text-sm text-white">Fiche d'Identité Institutionnelle</h3>
                  <div className="flex items-center gap-1.5">
                    {(!school.education_cycles || school.education_cycles.includes('primary')) && (
                      <span className="px-2.5 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-full font-black text-[10px]">
                        Primaire (3T/9P)
                      </span>
                    )}
                    {(!school.education_cycles || school.education_cycles.includes('secondary')) && (
                      <span className="px-2.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-full font-black text-[10px]">
                        Secondaire (2S/4P)
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    const hasPri = !school.education_cycles || school.education_cycles.includes('primary');
                    const hasSec = !school.education_cycles || school.education_cycles.includes('secondary');
                    setEditSelectedCycles(hasPri && hasSec ? 'both' : hasPri ? 'primary' : 'secondary');
                    setShowEditCyclesModal(true);
                  }}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold text-xs cursor-pointer border border-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <Edit className="w-3 h-3" />
                  <span>Modifier les Cycles</span>
                </button>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 block">Téléphone Direct :</span>
                  <span className="font-bold text-white">{school.phone || 'Non renseigné'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">WhatsApp Officiel :</span>
                  <span className="font-bold text-emerald-400">{school.whatsapp || 'Non renseigné'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Adresse Email :</span>
                  <span className="font-bold text-white">{school.email || 'Non renseigné'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Pays & Fuseau :</span>
                  <span className="font-bold text-white">{school.country || 'RD Congo'} ({school.timezone})</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Adresse Physique :</span>
                  <span className="font-bold text-white">{school.address || 'Non renseignée'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Date d'Enregistrement :</span>
                  <span className="font-mono text-slate-300">{new Date(school.created_at).toLocaleDateString('fr-FR')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CONFIGURATION */}
        {activeTab === 'configuration' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-6">
            <div>
              <h3 className="font-extrabold text-base text-white">Modification des Paramètres d'Établissement</h3>
              <p className="text-xs text-slate-400">Mise à jour directe dans la table <code>public.schools</code></p>
            </div>

            <form onSubmit={handleSaveConfiguration} className="space-y-4 max-w-2xl text-xs">
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                  Nom de l'Établissement *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                  Identifiant Unique / Slug *
                </label>
                <input
                  type="text"
                  required
                  value={editSlug}
                  onChange={e => setEditSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-amber-500/70 rounded-xl text-sm font-mono text-amber-300 font-bold focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Téléphone</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">WhatsApp</label>
                  <input
                    type="tel"
                    value={editWhatsapp}
                    onChange={e => setEditWhatsapp(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Adresse Email</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Pays</label>
                  <input
                    type="text"
                    value={editCountry}
                    onChange={e => setEditCountry(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Adresse physique</label>
                <input
                  type="text"
                  value={editAddress}
                  onChange={e => setEditAddress(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/20"
                />
              </div>

              <button
                type="submit"
                disabled={savingConfig}
                className="px-6 py-3 bg-rose-600 hover:bg-rose-700 font-extrabold text-white rounded-xl shadow-md cursor-pointer transition-colors"
              >
                {savingConfig ? 'Enregistrement...' : 'Enregistrer les Modifications'}
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: ADMINISTRATEURS */}
        {activeTab === 'administrateurs' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Gestionnaires d'Établissement (`school_admin`)</h3>
                <p className="text-xs text-slate-400">Administrateurs désignés pour gérer l'école</p>
              </div>
              <button
                onClick={() => setShowCreateAdminModal(true)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Nouveau Compte Admin</span>
              </button>
            </div>

            {admins.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucun administrateur d'école n'est encore créé.</p>
                <button
                  onClick={() => setShowCreateAdminModal(true)}
                  className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl cursor-pointer"
                >
                  Créer le premier administrateur
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Administrateur</th>
                      <th className="p-3">Identifiant / ID</th>
                      <th className="p-3">Téléphone</th>
                      <th className="p-3">Statut</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {admins.map(a => (
                      <tr key={a.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center font-extrabold text-rose-300 text-xs shrink-0">
                              {a.first_name?.[0] || 'A'}{a.last_name?.[0] || ''}
                            </div>
                            <div>
                              <p className="font-extrabold text-white">{a.first_name} {a.last_name}</p>
                              <span className="text-[10px] text-slate-400 font-mono">school_admin</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-amber-400 text-[11px]">{a.id}</td>
                        <td className="p-3 text-slate-300">{a.phone || 'Non renseigné'}</td>
                        <td className="p-3">
                          {a.is_active ? (
                            <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-bold text-[10px] inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Actif</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-full font-bold text-[10px] inline-flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              <span>Inactif</span>
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Voir Détails */}
                            <button
                              onClick={() => {
                                setSelectedAdmin(a);
                                setShowAdminDetailsModal(true);
                              }}
                              title="Voir les détails du compte"
                              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {/* Renvoyer l'invitation */}
                            <button
                              onClick={() => handleResendInvitation(a)}
                              title="Renvoyer l'invitation d'activation du compte"
                              className="p-1.5 bg-slate-800 hover:bg-rose-600/30 text-rose-400 hover:text-rose-300 rounded-lg transition-colors cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>

                            {/* Modifier */}
                            <button
                              onClick={() => openEditAdminModal(a)}
                              title="Modifier les coordonnées"
                              className="p-1.5 bg-slate-800 hover:bg-amber-600/30 text-amber-400 hover:text-amber-300 rounded-lg transition-colors cursor-pointer"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>

                            {/* Désactiver / Réactiver */}
                            <button
                              onClick={() => handleToggleAdminActive(a)}
                              title={a.is_active ? "Désactiver cet administrateur" : "Réactiver cet administrateur"}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                a.is_active
                                  ? 'bg-slate-800 hover:bg-rose-600/30 text-rose-400 hover:text-rose-300'
                                  : 'bg-slate-800 hover:bg-emerald-600/30 text-emerald-400 hover:text-emerald-300'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>

                            {/* Supprimer Définitivement */}
                            <button
                              onClick={() => openDeleteAdminModal(a)}
                              title="Supprimer définitivement"
                              className="p-1.5 bg-slate-800 hover:bg-red-600 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: ANNÉES SCOLAIRES */}
        {activeTab === 'annees_scolaires' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Registre des Années Scolaires</h3>
                <p className="text-xs text-slate-400">Une seule année peut être désignée comme année courante active</p>
              </div>
              <button
                onClick={() => setShowCreateYearModal(true)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Nouvelle Année Scolaire</span>
              </button>
            </div>

            {academicYears.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <Calendar className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucune année scolaire n'est configurée.</p>
                <button
                  onClick={() => setShowCreateYearModal(true)}
                  className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl cursor-pointer"
                >
                  Configurer la première année
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Libellé Année</th>
                      <th className="p-3">Période</th>
                      <th className="p-3">Statut Courant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {academicYears.map(y => (
                      <tr key={y.id}>
                        <td className="p-3 font-extrabold text-white text-sm">{y.name}</td>
                        <td className="p-3 font-mono text-slate-300">{y.starts_on} ➔ {y.ends_on}</td>
                        <td className="p-3">
                          {y.is_current ? (
                            <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-bold text-[10px]">
                              Année Courante Active
                            </span>
                          ) : (
                            <span className="text-slate-500">Archivée</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: CALENDRIER SCOLAIRE & DÉCOUPAGE RDC */}
        {activeTab === 'calendrier_scolaire' && (
          <div className="space-y-6">
            <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-400" />
                    <span>Calendrier Scolaire & Découpage RDC</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Supervision et datation des trimestres, semestres et périodes pour l'année scolaire courante ({currentYear ? currentYear.name : 'Aucune année active'})
                  </p>
                </div>

                {currentYear && (
                  <div className="flex flex-wrap items-center gap-2">
                    {(!school.education_cycles || school.education_cycles.includes('primary')) && (
                      <button
                        onClick={async () => {
                          try {
                            const { error } = await supabase.rpc('configure_drc_academic_calendar', {
                              p_academic_year_id: currentYear.id,
                              p_education_cycle: 'primary',
                              p_adopt_legacy_terms: false
                            });
                            if (error) throw error;
                            showToast("Structure Primaire RDC (3T/9P) configurée avec succès !", "success");
                            loadSchoolData();
                          } catch (e: any) {
                            showToast(e.message || "Erreur lors de la configuration", "warning");
                          }
                        }}
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Générer Structure Primaire (3T/9P)</span>
                      </button>
                    )}

                    {(!school.education_cycles || school.education_cycles.includes('secondary')) && (
                      <button
                        onClick={async () => {
                          try {
                            const { error } = await supabase.rpc('configure_drc_academic_calendar', {
                              p_academic_year_id: currentYear.id,
                              p_education_cycle: 'secondary',
                              p_adopt_legacy_terms: false
                            });
                            if (error) throw error;
                            showToast("Structure Secondaire RDC (2S/4P) configurée avec succès !", "success");
                            loadSchoolData();
                          } catch (e: any) {
                            showToast(e.message || "Erreur lors de la configuration", "warning");
                          }
                        }}
                        className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Générer Structure Secondaire (2S/4P)</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 1: CYCLE PRIMAIRE */}
            {(!school.education_cycles || school.education_cycles.includes('primary')) && (() => {
              const cal = schoolCalendars.find(c => c.academic_year_id === currentYear?.id && c.education_cycle === 'primary');
              const status = cal?.status || 'draft';
              const errs = getCycleValidationErrors('primary');
              const isComplete = errs.length === 0;

              return (
                <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-full font-black text-xs">
                        Cycle Primaire
                      </span>
                      <span className="text-xs text-slate-400 font-medium">3 Trimestres • 9 Périodes</span>

                      {/* Statut Badge */}
                      {status === 'active' ? (
                        <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-extrabold text-[11px] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          Calendrier Actif
                        </span>
                      ) : status === 'closed' ? (
                        <span className="px-2.5 py-0.5 bg-slate-700/50 text-slate-400 border border-slate-600 rounded-full font-extrabold text-[11px] flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5" />
                          Clôturé
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-extrabold text-[11px] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Brouillon
                        </span>
                      )}
                    </div>

                    {/* Actions de Statut Calendrier */}
                    <div className="flex items-center gap-2">
                      {status === 'draft' ? (
                        isComplete ? (
                          <button
                            onClick={() => handleActivateCalendar('primary')}
                            disabled={activatingCalendarCycle === 'primary'}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{activatingCalendarCycle === 'primary' ? 'Activation...' : 'Activer le Calendrier'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setConfigErrorsCycle('primary');
                              setShowConfigErrorsModal(true);
                            }}
                            className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                            <span>Erreurs ({errs.length})</span>
                          </button>
                        )
                      ) : status === 'active' ? (
                        <>
                          <button
                            onClick={() => handleOpenReopenModal('primary')}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Rouvrir</span>
                          </button>
                          <button
                            onClick={() => handleCloseCalendar('primary')}
                            className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Clôturer</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleOpenReopenModal('primary')}
                          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Rouvrir</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {schoolTerms.filter(t => t.education_cycle === 'primary').length === 0 ? (
                    <div className="p-6 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
                      <p className="text-slate-400">Le calendrier du cycle primaire n'a pas encore été généré pour cette année.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {schoolTerms
                        .filter(t => t.education_cycle === 'primary')
                        .sort((a, b) => a.position - b.position)
                        .map(term => {
                          const childPeriods = schoolPeriods.filter(p => p.parent_term_id === term.id);
                          return (
                            <div key={term.id} className="p-4 bg-slate-950 rounded-2xl border border-blue-500/30 space-y-3 flex flex-col justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                  <span className="font-extrabold text-white text-sm">{term.name}</span>
                                  <span className="font-mono text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                                    Trimestre #{term.position}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-xs bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                                  <div className="space-y-0.5">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dates du trimestre :</span>
                                    {term.starts_on && term.ends_on ? (
                                      <span className="font-mono text-emerald-400 text-xs font-bold flex items-center gap-1">
                                        <CalendarDays className="w-3 h-3 text-emerald-400" />
                                        {term.starts_on} ➔ {term.ends_on}
                                      </span>
                                    ) : (
                                      <span className="text-amber-400 text-[11px] font-semibold flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Dates non définies
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => {
                                      setSelectedTermForDates(term);
                                      setTermStartInput(term.starts_on || '');
                                      setTermEndInput(term.ends_on || '');
                                      setShowEditTermModal(true);
                                    }}
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] rounded-lg cursor-pointer transition-colors"
                                  >
                                    Modifier
                                  </button>
                                </div>

                                <div className="space-y-1.5 pt-1 text-xs">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase">Périodes associées :</p>
                                  {childPeriods.length === 0 ? (
                                    <p className="text-slate-500 text-[11px] italic">Aucune période</p>
                                  ) : (
                                    childPeriods.map(p => (
                                      <div key={p.id} className="p-2 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between">
                                        <div className="space-y-0.5">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-bold text-slate-200 text-xs">{p.name}</span>
                                            <span className="font-mono text-[10px] text-amber-400 font-bold">P{p.position} • {p.position_within_parent}/3</span>
                                          </div>
                                          {p.starts_on && p.ends_on ? (
                                            <span className="font-mono text-[10px] text-slate-400 block">
                                              {p.starts_on} ➔ {p.ends_on}
                                            </span>
                                          ) : (
                                            <span className="text-[10px] text-amber-400 italic block">
                                              Dates non définies
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => {
                                            setSelectedPeriodForDates(p);
                                            setPeriodStartInput(p.starts_on || '');
                                            setPeriodEndInput(p.ends_on || '');
                                            setShowEditPeriodModal(true);
                                          }}
                                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px] rounded-lg cursor-pointer transition-colors"
                                        >
                                          Datation
                                        </button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* SECTION 2: CYCLE SECONDAIRE */}
            {(!school.education_cycles || school.education_cycles.includes('secondary')) && (() => {
              const cal = schoolCalendars.find(c => c.academic_year_id === currentYear?.id && c.education_cycle === 'secondary');
              const status = cal?.status || 'draft';
              const errs = getCycleValidationErrors('secondary');
              const isComplete = errs.length === 0;

              return (
                <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 bg-purple-500/20 text-purple-300 border border-purple-500/40 rounded-full font-black text-xs">
                        Cycle Secondaire
                      </span>
                      <span className="text-xs text-slate-400 font-medium">2 Semestres • 4 Périodes</span>

                      {/* Statut Badge */}
                      {status === 'active' ? (
                        <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-extrabold text-[11px] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          Calendrier Actif
                        </span>
                      ) : status === 'closed' ? (
                        <span className="px-2.5 py-0.5 bg-slate-700/50 text-slate-400 border border-slate-600 rounded-full font-extrabold text-[11px] flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5" />
                          Clôturé
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-extrabold text-[11px] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Brouillon
                        </span>
                      )}
                    </div>

                    {/* Actions de Statut Calendrier */}
                    <div className="flex items-center gap-2">
                      {status === 'draft' ? (
                        isComplete ? (
                          <button
                            onClick={() => handleActivateCalendar('secondary')}
                            disabled={activatingCalendarCycle === 'secondary'}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{activatingCalendarCycle === 'secondary' ? 'Activation...' : 'Activer le Calendrier'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setConfigErrorsCycle('secondary');
                              setShowConfigErrorsModal(true);
                            }}
                            className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                            <span>Erreurs ({errs.length})</span>
                          </button>
                        )
                      ) : status === 'active' ? (
                        <>
                          <button
                            onClick={() => handleOpenReopenModal('secondary')}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Rouvrir</span>
                          </button>
                          <button
                            onClick={() => handleCloseCalendar('secondary')}
                            className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Clôturer</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleOpenReopenModal('secondary')}
                          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Rouvrir</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {schoolTerms.filter(t => t.education_cycle === 'secondary').length === 0 ? (
                    <div className="p-6 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
                      <p className="text-slate-400">Le calendrier du cycle secondaire n'a pas encore été généré pour cette année.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {schoolTerms
                        .filter(t => t.education_cycle === 'secondary')
                        .sort((a, b) => a.position - b.position)
                        .map(term => {
                          const childPeriods = schoolPeriods.filter(p => p.parent_term_id === term.id);
                          return (
                            <div key={term.id} className="p-4 bg-slate-950 rounded-2xl border border-purple-500/30 space-y-3 flex flex-col justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                  <span className="font-extrabold text-white text-sm">{term.name}</span>
                                  <span className="font-mono text-[10px] font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
                                    Semestre #{term.position}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-xs bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
                                  <div className="space-y-0.5">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dates du semestre :</span>
                                    {term.starts_on && term.ends_on ? (
                                      <span className="font-mono text-emerald-400 text-xs font-bold flex items-center gap-1">
                                        <CalendarDays className="w-3 h-3 text-emerald-400" />
                                        {term.starts_on} ➔ {term.ends_on}
                                      </span>
                                    ) : (
                                      <span className="text-amber-400 text-[11px] font-semibold flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Dates non définies
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => {
                                      setSelectedTermForDates(term);
                                      setTermStartInput(term.starts_on || '');
                                      setTermEndInput(term.ends_on || '');
                                      setShowEditTermModal(true);
                                    }}
                                    className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-[11px] rounded-lg cursor-pointer transition-colors"
                                  >
                                    Modifier
                                  </button>
                                </div>

                                <div className="space-y-1.5 pt-1 text-xs">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase">Périodes associées :</p>
                                  {childPeriods.length === 0 ? (
                                    <p className="text-slate-500 text-[11px] italic">Aucune période</p>
                                  ) : (
                                    childPeriods.map(p => (
                                      <div key={p.id} className="p-2 bg-slate-900 rounded-xl border border-slate-800 flex items-center justify-between">
                                        <div className="space-y-0.5">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-bold text-slate-200 text-xs">{p.name}</span>
                                            <span className="font-mono text-[10px] text-amber-400 font-bold">P{p.position} • {p.position_within_parent}/2</span>
                                          </div>
                                          {p.starts_on && p.ends_on ? (
                                            <span className="font-mono text-[10px] text-slate-400 block">
                                              {p.starts_on} ➔ {p.ends_on}
                                            </span>
                                          ) : (
                                            <span className="text-[10px] text-amber-400 italic block">
                                              Dates non définies
                                            </span>
                                          )}
                                        </div>
                                        <button
                                          onClick={() => {
                                            setSelectedPeriodForDates(p);
                                            setPeriodStartInput(p.starts_on || '');
                                            setPeriodEndInput(p.ends_on || '');
                                            setShowEditPeriodModal(true);
                                          }}
                                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-[10px] rounded-lg cursor-pointer transition-colors"
                                        >
                                          Datation
                                        </button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 6: CLASSES */}
        {activeTab === 'classes' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Classes & Salles de Cours</h3>
                <p className="text-xs text-slate-400">Salles et sections de l'établissement</p>
              </div>
              <button
                onClick={() => setShowCreateClassModal(true)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Nouvelle Classe</span>
              </button>
            </div>

            {classes.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucune classe n'est configurée pour cette école.</p>
                <button
                  onClick={() => setShowCreateClassModal(true)}
                  className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl cursor-pointer"
                >
                  Créer la première classe
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Classe</th>
                      <th className="p-3">Niveau</th>
                      <th className="p-3">Section</th>
                      <th className="p-3">Salle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {classes.map(c => (
                      <tr key={c.id}>
                        <td className="p-3 font-extrabold text-white text-sm">{c.name}</td>
                        <td className="p-3 text-slate-300">{c.level || 'N/A'}</td>
                        <td className="p-3 text-slate-300">{c.section || 'N/A'}</td>
                        <td className="p-3 font-mono text-amber-400">{c.room || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 7, 8, 9: ENSEIGNANTS / PARENTS / ÉLÈVES */}
        {['enseignants', 'parents', 'eleves'].includes(activeTab) && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-slate-800">
              <h3 className="font-extrabold text-base text-white uppercase">
                {activeTab === 'enseignants' && `Enseignants (${teachers.length})`}
                {activeTab === 'parents' && `Parents (${parents.length})`}
                {activeTab === 'eleves' && `Élèves (${students.length})`}
              </h3>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-300 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  placeholder="Rechercher par nom..."
                  value={searchUser}
                  onChange={e => setSearchUser(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500 font-medium"
                />
              </div>
            </div>

            <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <Users className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="font-bold text-slate-300">
                {activeTab === 'enseignants' && `${teachers.length} Enseignant(s) trouvé(s) dans Supabase.`}
                {activeTab === 'parents' && `${parents.length} Parent(s) trouvé(s) dans Supabase.`}
                {activeTab === 'eleves' && `${students.length} Élève(s) trouvé(s) dans Supabase.`}
              </p>
              <p className="text-slate-500 text-[11px]">
                L'inscription et le rattachement des utilisateurs réels s'effectuent via l'interface d'administration de l'établissement.
              </p>
            </div>
          </div>
        )}

        {/* TAB 10: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <h3 className="font-extrabold text-base text-white">Journal d'Activité d'Établissement</h3>
            {auditLogs.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 text-xs text-slate-400">
                Aucun événement enregistré dans les journaux d'audit pour cet établissement.
              </div>
            ) : (
              <div className="space-y-2 text-xs font-mono">
                {auditLogs.map(log => (
                  <div key={log.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                    <span className="text-rose-400 font-bold">{log.action}</span>
                    <span className="text-slate-400 text-[11px]">{new Date(log.created_at).toLocaleString('fr-FR')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal: Modifier l'établissement */}
      <Modal
        isOpen={showEditSchoolModal}
        onClose={() => setShowEditSchoolModal(false)}
        title="Modifier la Configuration de l’École"
        darkMode={true}
      >
        <form onSubmit={handleSaveConfiguration} className="space-y-4">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nom *</label>
            <input
              type="text"
              required
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Slug *</label>
            <input
              type="text"
              required
              value={editSlug}
              onChange={e => setEditSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-amber-500/70 rounded-xl text-sm font-mono text-amber-300 font-bold focus:outline-none focus:border-rose-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowEditSchoolModal(false)}
              className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={savingConfig}
              className="px-5 py-2 text-xs font-extrabold bg-rose-600 text-white rounded-xl shadow-md"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Suspension */}
      <Modal
        isOpen={showSuspendModal}
        onClose={() => setShowSuspendModal(false)}
        title={school.status === 'active' ? "Suspendre l'Établissement" : "Réactiver l'Établissement"}
        darkMode={true}
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-300">
            {school.status === 'active'
              ? `Êtes-vous sûr de vouloir suspendre l'accès pour "${school.name}" ? Tous les comptes associés seront temporairement bloqués à la connexion.`
              : `Êtes-vous sûr de vouloir réactiver l'accès pour "${school.name}" ?`}
          </p>

          {school.status === 'active' && (
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Motif de suspension *
              </label>
              <textarea
                rows={3}
                required
                placeholder="Précisez la raison de la suspension (ex: défaut de paiement, audit en cours)..."
                value={suspensionReasonInput}
                onChange={e => setSuspensionReasonInput(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white placeholder:text-slate-400 focus:outline-none focus:border-rose-500"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowSuspendModal(false)}
              className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleConfirmSuspension}
              className={`px-5 py-2 text-xs font-extrabold rounded-xl shadow-md text-white ${
                school.status === 'active' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              Confirmer {school.status === 'active' ? 'la Suspension' : 'la Réactivation'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Créer un Admin d'École */}
      <Modal
        isOpen={showCreateAdminModal}
        onClose={() => setShowCreateAdminModal(false)}
        title="Créer un Administrateur d'Établissement"
        darkMode={true}
      >
        <form onSubmit={handleCreateSchoolAdmin} className="space-y-4 text-xs">
          {adminErrorMsg && (
            <div className="p-3.5 bg-rose-500/10 border-2 border-rose-500/40 rounded-xl text-rose-300 text-xs font-semibold flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <div className="space-y-1">
                <p className="leading-relaxed">{adminErrorMsg}</p>
                <button
                  type="button"
                  onClick={handleCreateSchoolAdmin}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Réessayer
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Prénom *</label>
            <input
              type="text"
              required
              value={adminFirstName}
              onChange={e => setAdminFirstName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nom *</label>
            <input
              type="text"
              required
              value={adminLastName}
              onChange={e => setAdminLastName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Adresse Email *</label>
            <input
              type="email"
              required
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Téléphone</label>
            <input
              type="tel"
              value={adminPhone}
              onChange={e => setAdminPhone(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowCreateAdminModal(false)}
              className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={creatingAdmin}
              className="px-5 py-2 text-xs font-extrabold bg-rose-600 text-white rounded-xl shadow-md"
            >
              {creatingAdmin ? 'Création...' : 'Créer l’Administrateur'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Créer une Année Scolaire */}
      <Modal
        isOpen={showCreateYearModal}
        onClose={() => setShowCreateYearModal(false)}
        title="Créer une Année Scolaire"
        darkMode={true}
      >
        <form onSubmit={handleCreateAcademicYear} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Intitulé (ex: 2026–2027) *</label>
            <input
              type="text"
              required
              value={yearName}
              onChange={e => setYearName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date Début *</label>
              <input
                type="date"
                required
                value={yearStartsOn}
                onChange={e => setYearStartsOn(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date Fin *</label>
              <input
                type="date"
                required
                value={yearEndsOn}
                onChange={e => setYearEndsOn(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={yearIsCurrent}
              onChange={e => setYearIsCurrent(e.target.checked)}
              className="w-4 h-4 rounded text-rose-600 bg-slate-950 border-2 border-slate-600"
            />
            <span className="text-xs font-bold text-slate-200">Définir comme année courante active</span>
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowCreateYearModal(false)}
              className="px-4 py-2 text-xs font-bold text-slate-300"
            >
              Annuler
            </button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-rose-600 text-white rounded-xl">
              Créer l'Année
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Créer un Trimestre */}
      <Modal
        isOpen={showCreateTermModal}
        onClose={() => setShowCreateTermModal(false)}
        title="Créer un Trimestre"
        darkMode={true}
      >
        <form onSubmit={handleCreateSchoolTerm} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Intitulé *</label>
            <input
              type="text"
              required
              value={termName}
              onChange={e => setTermName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Position (1, 2, 3) *</label>
            <input
              type="number"
              min="1"
              max="6"
              value={termPosition}
              onChange={e => setTermPosition(parseInt(e.target.value))}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date Début</label>
              <input
                type="date"
                value={termStartsOn}
                onChange={e => setTermStartsOn(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date Fin</label>
              <input
                type="date"
                value={termEndsOn}
                onChange={e => setTermEndsOn(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowCreateTermModal(false)}
              className="px-4 py-2 text-xs font-bold text-slate-300"
            >
              Annuler
            </button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-rose-600 text-white rounded-xl">
              Enregistrer le Trimestre
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Créer une Classe */}
      <Modal
        isOpen={showCreateClassModal}
        onClose={() => setShowCreateClassModal(false)}
        title="Créer une Classe"
        darkMode={true}
      >
        <form onSubmit={handleCreateClass} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nom de la Classe (ex: 7ème EB - A) *</label>
            <input
              type="text"
              required
              value={className}
              onChange={e => setClassName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Niveau</label>
              <input
                type="text"
                value={classLevel}
                onChange={e => setClassLevel(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Section</label>
              <input
                type="text"
                value={classSection}
                onChange={e => setClassSection(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Salle</label>
              <input
                type="text"
                value={classRoom}
                onChange={e => setClassRoom(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Professeur Titulaire (Optionnel)</label>
            <select
              value={classTeacherId}
              onChange={e => setClassTeacherId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 cursor-pointer"
            >
              <option value="" className="bg-slate-900 text-white">-- Aucun titulaire pour le moment --</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                  {t.first_name} {t.last_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowCreateClassModal(false)}
              className="px-4 py-2 text-xs font-bold text-slate-300"
            >
              Annuler
            </button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-rose-600 text-white rounded-xl">
              Créer la Classe
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 1: Détails Administrateur */}
      {selectedAdmin && showAdminDetailsModal && (
        <Modal
          isOpen={showAdminDetailsModal}
          onClose={() => setShowAdminDetailsModal(false)}
          title="Fiche Administrateur d'Établissement"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 border-2 border-rose-500/40 flex items-center justify-center font-black text-rose-300 text-lg">
                {selectedAdmin.first_name?.[0]}{selectedAdmin.last_name?.[0]}
              </div>
              <div>
                <h4 className="font-extrabold text-sm text-white">{selectedAdmin.first_name} {selectedAdmin.last_name}</h4>
                <p className="text-slate-400">Administrateur d'Établissement (<code>school_admin</code>)</p>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Identifiant Unique / Profile ID :</span>
                <span className="font-mono text-amber-400 font-bold">{selectedAdmin.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Téléphone Direct :</span>
                <span className="font-bold text-white">{selectedAdmin.phone || 'Non renseigné'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Statut d'Accès :</span>
                <span className={`font-bold ${selectedAdmin.is_active ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {selectedAdmin.is_active ? 'Actif (Accès Autorisé)' : 'Inactif (Accès Bloqué)'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Établissement Rattrapé :</span>
                <span className="font-bold text-white">{school?.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Date de Création :</span>
                <span className="font-mono text-slate-300">{new Date(selectedAdmin.created_at).toLocaleString('fr-FR')}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowAdminDetailsModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal 2: Modifier Administrateur */}
      {selectedAdmin && showEditAdminModal && (
        <Modal
          isOpen={showEditAdminModal}
          onClose={() => setShowEditAdminModal(false)}
          title="Modifier le Compte Administrateur"
          darkMode={true}
        >
          <form onSubmit={handleSaveEditAdmin} className="space-y-4 text-xs">
            {editAdminErrorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl text-rose-300 font-medium">
                {editAdminErrorMsg}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Prénom *</label>
                <input
                  type="text"
                  required
                  value={editAdminFirstName}
                  onChange={e => setEditAdminFirstName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Nom *</label>
                <input
                  type="text"
                  required
                  value={editAdminLastName}
                  onChange={e => setEditAdminLastName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Téléphone</label>
              <input
                type="tel"
                value={editAdminPhone}
                onChange={e => setEditAdminPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">
                Nouvel Email (Optionnel - Met à jour Auth & Profil via Edge Function)
              </label>
              <input
                type="email"
                placeholder="Laisser vide pour ne pas modifier l'email Auth"
                value={editAdminEmail}
                onChange={e => setEditAdminEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500 placeholder:text-slate-600"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowEditAdminModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingAdmin}
                className="px-5 py-2 text-xs font-extrabold bg-rose-600 hover:bg-rose-700 text-white rounded-xl cursor-pointer"
              >
                {savingAdmin ? 'Mise à jour...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal 3: Suppression Définitive Administrateur (SANS confirm browser) */}
      {selectedAdmin && showDeleteAdminModal && (
        <Modal
          isOpen={showDeleteAdminModal}
          onClose={() => setShowDeleteAdminModal(false)}
          title="Suppression Définitive de l'Administrateur"
          darkMode={true}
        >
          <form onSubmit={handleConfirmDeleteAdmin} className="space-y-4 text-xs">
            <div className="p-4 bg-rose-950/40 border-2 border-rose-500/50 rounded-2xl flex items-start gap-3 text-rose-300">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-extrabold text-rose-200 text-sm">Action Irrreversible</h4>
                <p className="mt-0.5 leading-relaxed text-slate-300">
                  Vous êtes sur le point de supprimer définitivement ce compte administrateur. Le compte Auth sera supprimé et le profil sera nettoyé tout en conservant l'historique d'audit.
                </p>
              </div>
            </div>

            {deleteAdminErrorMsg && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/40 rounded-xl text-amber-300 font-medium">
                {deleteAdminErrorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1.5">
                Veuillez saisir exactement le nom complet de l'administrateur pour confirmer :
              </label>
              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl font-mono text-amber-400 font-bold text-center mb-2">
                {selectedAdmin.first_name} {selectedAdmin.last_name}
              </div>
              <input
                type="text"
                required
                placeholder="Tapez le nom complet ici"
                value={deleteAdminConfirmName}
                onChange={e => setDeleteAdminConfirmName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-rose-500/60 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowDeleteAdminModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={deletingAdmin || deleteAdminConfirmName.trim() !== `${selectedAdmin.first_name} ${selectedAdmin.last_name}`.trim()}
                className="px-5 py-2 text-xs font-extrabold bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl cursor-pointer"
              >
                {deletingAdmin ? 'Suppression...' : 'Supprimer Définitivement'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Modifier les Cycles d'Enseignement */}
      <Modal
        isOpen={showEditCyclesModal}
        onClose={() => setShowEditCyclesModal(false)}
        title="Modifier les Cycles d'Enseignement Organisés"
        darkMode={true}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingCycles(true);
            try {
              const cyclesArr = editSelectedCycles === 'both' ? ['primary', 'secondary'] : [editSelectedCycles];
              const { error } = await supabase.rpc('update_school_education_cycles', {
                p_school_id: schoolId,
                p_education_cycles: cyclesArr
              });
              if (error) throw error;
              showToast("Cycles d'enseignement mis à jour avec succès !", "success");
              setShowEditCyclesModal(false);
              loadSchoolData();
            } catch (err: any) {
              showToast(err.message || "Erreur lors de la mise à jour des cycles", "warning");
            } finally {
              setSavingCycles(false);
            }
          }}
          className="space-y-4 text-xs"
        >
          <p className="text-slate-300">
            Sélectionnez les cycles d'enseignement reconnus et gérés pour cet établissement :
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div
              onClick={() => setEditSelectedCycles('primary')}
              className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                editSelectedCycles === 'primary'
                  ? 'bg-blue-600/20 border-blue-500 text-white shadow-lg'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="font-extrabold text-sm text-blue-400 mb-1">Primaire</div>
              <p className="text-[11px] text-slate-400">3 Trimestres • 9 Périodes</p>
            </div>

            <div
              onClick={() => setEditSelectedCycles('secondary')}
              className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                editSelectedCycles === 'secondary'
                  ? 'bg-purple-600/20 border-purple-500 text-white shadow-lg'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="font-extrabold text-sm text-purple-400 mb-1">Secondaire</div>
              <p className="text-[11px] text-slate-400">2 Semestres • 4 Périodes</p>
            </div>

            <div
              onClick={() => setEditSelectedCycles('both')}
              className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                editSelectedCycles === 'both'
                  ? 'bg-rose-600/20 border-rose-500 text-white shadow-lg'
                  : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
              }`}
            >
              <div className="font-extrabold text-sm text-rose-400 mb-1">Mixte (Les deux)</div>
              <p className="text-[11px] text-slate-400">Primaire & Secondaire</p>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-[11px]">
            <strong>Note de sécurité :</strong> Le système empêchera le retrait d'un cycle si des classes y sont déjà rattachées.
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowEditCyclesModal(false)}
              className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={savingCycles}
              className="px-5 py-2 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-md cursor-pointer disabled:opacity-50"
            >
              {savingCycles ? 'Enregistrement...' : 'Enregistrer les Modifications'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Super Admin: Modifier Dates Terme */}
      {showEditTermModal && selectedTermForDates && (
        <Modal
          isOpen={showEditTermModal}
          onClose={() => setShowEditTermModal(false)}
          title={`Datation : ${selectedTermForDates.name}`}
          darkMode={true}
        >
          <form onSubmit={handleSaveTermDates} className="space-y-4 text-xs">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
              <span className="text-slate-400 text-[11px] block">
                Année scolaire : <strong className="text-white">{currentYear?.name}</strong> ({currentYear?.starts_on} au {currentYear?.ends_on})
              </span>
              <span className="text-slate-400 text-[11px] block">
                Cycle : <strong className="text-amber-400 uppercase">{selectedTermForDates.education_cycle}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date de Début *</label>
                <input
                  type="date"
                  required
                  value={termStartInput}
                  onChange={e => setTermStartInput(e.target.value)}
                  min={currentYear?.starts_on}
                  max={currentYear?.ends_on}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date de Fin *</label>
                <input
                  type="date"
                  required
                  value={termEndInput}
                  onChange={e => setTermEndInput(e.target.value)}
                  min={termStartInput || currentYear?.starts_on}
                  max={currentYear?.ends_on}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {(() => {
              const err = validateTermDateInputs(termStartInput, termEndInput, selectedTermForDates.education_cycle, selectedTermForDates.id);
              if (err) {
                return (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{err}</span>
                  </div>
                );
              }
              return null;
            })()}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowEditTermModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingTermDates || !termStartInput || !termEndInput}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black disabled:opacity-50 cursor-pointer"
              >
                {savingTermDates ? 'Enregistrement...' : 'Enregistrer les Dates'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Super Admin: Modifier Dates Période */}
      {showEditPeriodModal && selectedPeriodForDates && (
        <Modal
          isOpen={showEditPeriodModal}
          onClose={() => setShowEditPeriodModal(false)}
          title={`Datation : ${selectedPeriodForDates.name}`}
          darkMode={true}
        >
          <form onSubmit={handleSavePeriodDates} className="space-y-4 text-xs">
            {(() => {
              const parent = schoolTerms.find(t => t.id === selectedPeriodForDates.parent_term_id);
              return (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-slate-400 text-[11px] block">
                    Terme parent : <strong className="text-white">{parent?.name || 'N/A'}</strong> ({parent?.starts_on || 'Non défini'} au {parent?.ends_on || 'Non défini'})
                  </span>
                  <span className="text-slate-400 text-[11px] block">
                    Cycle : <strong className="text-amber-400 uppercase">{selectedPeriodForDates.education_cycle}</strong>
                  </span>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date de Début *</label>
                <input
                  type="date"
                  required
                  value={periodStartInput}
                  onChange={e => setPeriodStartInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date de Fin *</label>
                <input
                  type="date"
                  required
                  value={periodEndInput}
                  onChange={e => setPeriodEndInput(e.target.value)}
                  min={periodStartInput}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {(() => {
              const err = validatePeriodDateInputs(periodStartInput, periodEndInput, selectedPeriodForDates.parent_term_id, selectedPeriodForDates.id);
              if (err) {
                return (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{err}</span>
                  </div>
                );
              }
              return null;
            })()}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowEditPeriodModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingPeriodDates || !periodStartInput || !periodEndInput}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black disabled:opacity-50 cursor-pointer"
              >
                {savingPeriodDates ? 'Enregistrement...' : 'Enregistrer les Dates'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal Super Admin: Erreurs de Configuration */}
      {showConfigErrorsModal && (
        <Modal
          isOpen={showConfigErrorsModal}
          onClose={() => setShowConfigErrorsModal(false)}
          title={`Validation du Calendrier Scolaire — ${configErrorsCycle === 'primary' ? 'Cycle Primaire' : 'Cycle Secondaire'}`}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300">
              Pour activer et publier ce Calendrier Scolaire, tous les éléments suivants doivent être conformes :
            </div>

            <div className="space-y-2">
              {getCycleValidationErrors(configErrorsCycle).map((err, idx) => (
                <div key={idx} className="p-3 bg-slate-950 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-rose-300">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{err}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowConfigErrorsModal(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Super Admin: Rouvrir le Calendrier Scolaire en Brouillon */}
      {showReopenCalendarModal && (
        <Modal
          isOpen={showReopenCalendarModal}
          onClose={() => setShowReopenCalendarModal(false)}
          title={`Supervision : Réouverture du Calendrier — ${reopenCalendarCycle === 'primary' ? 'Cycle Primaire' : 'Cycle Secondaire'}`}
          darkMode={true}
        >
          <form onSubmit={handleConfirmReopenCalendar} className="space-y-4 text-xs">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 space-y-1">
              <p className="font-extrabold text-white">Action Administrative : Repassage en Brouillon</p>
              <p className="text-[11px] leading-relaxed">
                La réouverture repasse le calendrier en statut <code>draft</code> pour permettre de corriger les dates. Un motif explicite est requis pour le journal d'audit.
              </p>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Motif de réouverture (minimum 5 caractères) *
              </label>
              <textarea
                required
                rows={3}
                placeholder="Ex: Correction des dates de trimestres / semestres..."
                value={reopenReasonInput}
                onChange={e => setReopenReasonInput(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowReopenCalendarModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={reopeningCalendar || reopenReasonInput.trim().length < 5}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black disabled:opacity-50 cursor-pointer"
              >
                {reopeningCalendar ? 'Réouverture...' : 'Confirmer la Réouverture'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Footer */}
      <footer className="p-4 sm:p-6 border-t border-slate-900 text-center text-xs text-slate-500">
        Console de Supervision Établissement — PaTShi-Digital Root Admin
      </footer>
    </div>
  );
};
