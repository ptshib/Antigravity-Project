// Fichier : src/pages/student/RealStudentPortal.tsx
// Portail Élève Réel : Consultation officielle des résultats, bulletin PDF et emploi du temps (Phase 2K-T6-F)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { StudentPortalSidebar } from '../../components/student/portal/StudentPortalSidebar';
import type { StudentPortalTab } from '../../components/student/portal/StudentPortalSidebar';
import type { StudentTimetableData, TimetableSlot } from '../../types/studentTimetable';
import {
  parseStudentHomeworkData,
  computeHomeworkStatus,
  formatHomeworkAssignedDate,
  formatHomeworkDueDate
} from '../../types/studentHomework';
import type {
  StudentHomeworkData,
  HomeworkFilter
} from '../../types/studentHomework';
import {
  GraduationCap,
  Award,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  LogOut,
  Eye,
  RefreshCw,
  Download,
  FileCheck,
  ShieldCheck,
  Menu,
  Calendar,
  MapPin,
  User,
  Coffee,
  ClipboardCheck
} from 'lucide-react';
import { downloadReportCardPdfBlob, isPublishedPdfMetadataComplete } from '../../services/reportCardPdfService';
import { buildGetSchoolCalendarParams, extractAndSortCalendarPeriods } from '../../services/calendarService';

interface StudentRecord {
  id: string;
  school_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  enrollment_status: string;
}

interface PeriodResultSubject {
  subject_id: string;
  subject_name: string;
  subject_coefficient: number;
  subject_percentage: number | null;
  is_complete: boolean;
  assessment_count: number;
  completed_assessment_count: number;
  pending_assessment_count: number;
}

interface StudentPeriodResult {
  student_id: string;
  student_number: string;
  student_name: string;
  class_name: string;
  period_name: string;
  term_name: string;
  subjects_count: number;
  completed_subjects_count: number;
  pending_subjects_count: number;
  total_subject_coefficients: number;
  overall_percentage: number | null;
  is_complete: boolean;
  subjects: PeriodResultSubject[];
}

interface OfficialStudentReportCard {
  id: string;
  rank: number | null;
  overall_percentage: number | null;
  pdf_storage_path: string | null;
  pdf_version: number | null;
  pdf_generated_at: string | null;
  pdf_checksum: string | null;
  principal_remarks: string | null;
  homeroom_teacher_remarks: string | null;
}

const DAYS_MAP: Array<{ day_of_week: number; day_name: string }> = [
  { day_of_week: 1, day_name: 'Lundi' },
  { day_of_week: 2, day_name: 'Mardi' },
  { day_of_week: 3, day_name: 'Mercredi' },
  { day_of_week: 4, day_name: 'Jeudi' },
  { day_of_week: 5, day_name: 'Vendredi' },
  { day_of_week: 6, day_name: 'Samedi' }
];

export const RealStudentPortal: React.FC = () => {
  const { profile, school, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  const [activeTab, setActiveTab] = useState<StudentPortalTab>('resultats');
  const [isOpenMobile, setIsOpenMobile] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [studentRecord, setStudentRecord] = useState<StudentRecord | null>(null);
  const [classInfo, setClassInfo] = useState<{
    id: string;
    name: string;
    education_cycle: string;
    academic_year_id: string;
    academic_year_name?: string;
  } | null>(null);

  // Calendar
  const [calendarPeriods, setCalendarPeriods] = useState<any[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');

  // Results & Official Report Card
  const [loadingResults, setLoadingResults] = useState<boolean>(false);
  const [periodResult, setPeriodResult] = useState<StudentPeriodResult | null>(null);
  const [officialReportCard, setOfficialReportCard] = useState<OfficialStudentReportCard | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

  // Timetable (Phase 2K-T6-F)
  const [loadingTimetable, setLoadingTimetable] = useState<boolean>(false);
  const [timetableData, setTimetableData] = useState<StudentTimetableData | null>(null);
  const [timetableError, setTimetableError] = useState<string | null>(null);

  // Homework (Phase 2K-T7-F)
  const [loadingHomework, setLoadingHomework] = useState<boolean>(false);
  const [homeworkData, setHomeworkData] = useState<StudentHomeworkData | null>(null);
  const [homeworkError, setHomeworkError] = useState<string | null>(null);
  const [homeworkFilter, setHomeworkFilter] = useState<HomeworkFilter>('all');

  // Subject Detail Modal
  const [selectedSubjectDetail, setSelectedSubjectDetail] = useState<{
    subject: PeriodResultSubject;
    assessments: any[];
    loading: boolean;
  } | null>(null);

  // Anti-spam notifications ref
  const lastToastErrorRef = useRef<string | null>(null);

  const notifyErrorOnce = useCallback((message: string) => {
    if (lastToastErrorRef.current !== message) {
      lastToastErrorRef.current = message;
      showToast(message, 'warning');
    }
  }, [showToast]);

  // 1. Chargement du dossier élève, de son inscription active et du calendrier officiel
  const loadPortalData = useCallback(async () => {
    if (!profile?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setPortalError(null);

    try {
      const authUid = (await supabase.auth.getUser()).data.user?.id || profile.id;

      // 1.1 Récupérer le dossier élève lié à ce profile_id
      const { data: studentData, error: studentError } = await supabase
        .from('students')
        .select('id, school_id, student_number, first_name, last_name, enrollment_status')
        .eq('profile_id', authUid)
        .maybeSingle();

      if (studentError) {
        console.error('[RealStudentPortal] Erreur students:', studentError, { authUid });
        throw new Error("Dossier élève introuvable pour ce compte utilisateur.");
      }

      if (!studentData) {
        throw new Error("Dossier élève introuvable pour ce compte utilisateur.");
      }

      setStudentRecord(studentData as StudentRecord);

      // 1.2 Récupérer l'inscription active de l'élève
      const { data: enrollmentData, error: enrError } = await supabase
        .from('student_enrollments')
        .select(`
          id,
          class_id,
          school_id,
          academic_year_id,
          status,
          class:classes (
            id,
            name,
            education_cycle,
            academic_year_id
          ),
          academic_year:academic_years (
            id,
            name
          )
        `)
        .eq('student_id', studentData.id)
        .eq('status', 'active')
        .maybeSingle();

      if (enrError) {
        console.error('[RealStudentPortal] Erreur student_enrollments:', enrError, { student_id: studentData.id });
        throw new Error("Aucune inscription active trouvée pour l'année scolaire en cours.");
      }

      if (!enrollmentData || !enrollmentData.class) {
        throw new Error("Votre compte n’est rattaché à aucune classe active.");
      }

      const cl = enrollmentData.class as any;
      const ay = enrollmentData.academic_year as any;
      setClassInfo({
        id: cl.id,
        name: cl.name,
        education_cycle: cl.education_cycle,
        academic_year_id: cl.academic_year_id,
        academic_year_name: ay?.name || undefined
      });

      // 1.3 Charger le calendrier scolaire officiel
      const calParams = buildGetSchoolCalendarParams(
        studentData.school_id,
        enrollmentData.academic_year_id || cl.academic_year_id,
        cl.education_cycle
      );

      if (!calParams) {
        throw new Error("Informations d'établissement ou de cycle scolaire incomplètes.");
      }

      const { data: calendarData, error: calError } = await supabase.rpc('get_school_calendar', calParams);
      if (calError) {
        console.error('[RealStudentPortal] Erreur RPC get_school_calendar:', calError, {
          authUid,
          school_id: studentData.school_id,
          params: calParams
        });

        const inactiveMsg = "Le calendrier scolaire de votre établissement n'est pas encore configuré ou actif.";
        if (
          calError.message?.includes('inactif') ||
          calError.message?.includes('suspendu') ||
          calError.message?.includes('introuvable') ||
          calError.message?.includes('non encore publié')
        ) {
          setPortalError(inactiveMsg);
          setCalendarPeriods([]);
          return;
        }
        throw new Error("Impossible de charger le calendrier scolaire. Veuillez réessayer ultérieurement.");
      }

      const sortedPeriods = extractAndSortCalendarPeriods(calendarData);

      if (sortedPeriods.length === 0) {
        setPortalError("Aucune période d'évaluation n'est actuellement configurée pour votre cycle.");
        setCalendarPeriods([]);
        return;
      }

      setCalendarPeriods(sortedPeriods);

      if (sortedPeriods.length > 0) {
        setSelectedPeriodId(sortedPeriods[0].id);
      }
    } catch (err: any) {
      console.error('[RealStudentPortal] Échec de chargement:', err);
      const friendly = err.message || "Impossible de charger votre espace élève. Veuillez vérifier votre connexion.";
      setPortalError(friendly);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  useEffect(() => {
    loadPortalData();
  }, [loadPortalData]);

  // 2. Chargement des résultats académiques et vérification du bulletin officiel publié
  const loadResults = useCallback(async () => {
    if (!studentRecord?.id || !selectedPeriodId) {
      setPeriodResult(null);
      setOfficialReportCard(null);
      return;
    }

    setLoadingResults(true);
    try {
      const { data: rawData, error } = await supabase.rpc('get_student_period_result', {
        p_student_id: studentRecord.id,
        p_period_id: selectedPeriodId
      });

      if (error) {
        console.error('[RealStudentPortal] Erreur get_student_period_result:', error);
      }

      const resData = Array.isArray(rawData) ? rawData[0] : rawData;
      setPeriodResult(resData ? (resData as StudentPeriodResult) : null);

      const { data: rcData, error: rcErr } = await supabase
        .from('period_report_cards')
        .select(`
          id, rank, overall_percentage, pdf_storage_path, pdf_version, pdf_generated_at, pdf_checksum,
          principal_remarks, homeroom_teacher_remarks,
          batch:report_card_batches!inner(status)
        `)
        .eq('student_id', studentRecord.id)
        .eq('period_id', selectedPeriodId)
        .eq('batch.status', 'published')
        .maybeSingle();

      if (rcErr) {
        console.error('[RealStudentPortal] Erreur chargement bulletin officiel:', rcErr);
        notifyErrorOnce("Erreur lors de la récupération du bulletin officiel.");
        setOfficialReportCard(null);
      } else if (rcData && isPublishedPdfMetadataComplete(rcData)) {
        setOfficialReportCard({
          id: rcData.id,
          rank: rcData.rank,
          overall_percentage: rcData.overall_percentage,
          pdf_storage_path: rcData.pdf_storage_path,
          pdf_version: rcData.pdf_version,
          pdf_generated_at: rcData.pdf_generated_at,
          pdf_checksum: rcData.pdf_checksum,
          principal_remarks: rcData.principal_remarks,
          homeroom_teacher_remarks: rcData.homeroom_teacher_remarks
        });
      } else {
        setOfficialReportCard(null);
      }
    } catch (err: any) {
      console.error('[RealStudentPortal] Erreur résultats / bulletin:', err);
      setPeriodResult(null);
      setOfficialReportCard(null);
    } finally {
      setLoadingResults(false);
    }
  }, [studentRecord?.id, selectedPeriodId, notifyErrorOnce]);

  useEffect(() => {
    if (activeTab === 'resultats' && studentRecord?.id && selectedPeriodId) {
      loadResults();
    }
  }, [activeTab, studentRecord?.id, selectedPeriodId, loadResults]);

  // 3. Appel backend unique pour l'Emploi du Temps Élève (Phase 2K-T6-F)
  const loadStudentTimetable = useCallback(async () => {
    setLoadingTimetable(true);
    setTimetableError(null);
    try {
      // APPEL STRICT SANS PARAMÈTRES ET SANS IDENTIFIANTS CLIENTS
      const { data: rawData, error: rpcError } = await supabase.rpc('get_authenticated_student_timetable');

      if (rpcError) {
        console.error('[RealStudentPortal] Erreur RPC timetable:', rpcError);
        if (rpcError.code === '42501' || rpcError.message?.includes('REJET ACCÈS')) {
          setTimetableError(rpcError.message || "Accès non autorisé à l'emploi du temps.");
        } else {
          setTimetableError("Impossible de charger l'emploi du temps. Veuillez réessayer.");
        }
        setTimetableData(null);
        return;
      }

      // Validation défensive du contrat JSON
      if (!rawData || typeof rawData !== 'object') {
        setTimetableError("Réponse de l'emploi du temps malformée.");
        setTimetableData(null);
        return;
      }

      const rawSlots = Array.isArray(rawData.slots) ? rawData.slots : [];
      const safeSlots: TimetableSlot[] = rawSlots.map((s: any) => ({
        slot_type: String(s?.slot_type || 'course'),
        label: s?.label ? String(s.label) : null,
        day_of_week: Number(s?.day_of_week || 1),
        day_name: String(s?.day_name || 'Jour'),
        subject_name: String(s?.subject_name || (s?.slot_type === 'break' ? 'Pause' : 'Matière non spécifiée')),
        teacher_name: String(s?.teacher_name || (s?.slot_type === 'break' ? '' : 'Enseignant non assigné')),
        room: String(s?.room || ''),
        start_time: String(s?.start_time || ''),
        end_time: String(s?.end_time || '')
      }));

      const parsedData: StudentTimetableData = {
        student_name: String(rawData.student_name || profile?.first_name || 'Élève'),
        student_number: String(rawData.student_number || studentRecord?.student_number || ''),
        class_name: String(rawData.class_name || classInfo?.name || 'Classe non définie'),
        academic_year_name: String(rawData.academic_year_name || classInfo?.academic_year_name || 'Année non spécifiée'),
        summary: {
          total_slots: Number(rawData.summary?.total_slots ?? safeSlots.length),
          total_days: Number(rawData.summary?.total_days ?? 0)
        },
        slots: safeSlots
      };

      setTimetableData(parsedData);
    } catch (err: any) {
      console.error('[RealStudentPortal] Échec de chargement emploi du temps:', err);
      setTimetableError(err.message || "Erreur réseau lors du chargement de l'emploi du temps.");
      setTimetableData(null);
    } finally {
      setLoadingTimetable(false);
    }
  }, [profile?.first_name, studentRecord?.student_number, classInfo?.name, classInfo?.academic_year_name]);

  useEffect(() => {
    if (activeTab === 'emploi_du_temps') {
      loadStudentTimetable();
    }
  }, [activeTab, loadStudentTimetable]);

  // 3b. Appel backend unique pour les Devoirs Élève (Phase 2K-T7-F)
  const loadStudentHomework = useCallback(async () => {
    setLoadingHomework(true);
    setHomeworkError(null);
    try {
      // APPEL STRICT SANS PARAMÈTRES ET SANS IDENTIFIANTS CLIENTS
      const { data: rawData, error: rpcError } = await supabase.rpc('get_authenticated_student_homework');

      if (rpcError) {
        console.error('[RealStudentPortal] Erreur RPC homework:', rpcError);
        if (rpcError.code === '42501' || rpcError.message?.includes('REJET ACCÈS')) {
          setHomeworkError(rpcError.message || "Accès non autorisé aux devoirs.");
        } else {
          setHomeworkError("Impossible de charger les devoirs. Veuillez réessayer.");
        }
        setHomeworkData(null);
        return;
      }

      const parsed = parseStudentHomeworkData(rawData);
      setHomeworkData(parsed);
    } catch (err: any) {
      console.error('[RealStudentPortal] Échec de chargement devoirs:', err);
      setHomeworkError(err.message || "Erreur réseau lors du chargement des devoirs.");
      setHomeworkData(null);
    } finally {
      setLoadingHomework(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'devoirs') {
      loadStudentHomework();
    }
  }, [activeTab, loadStudentHomework]);

  // Refresh handler pour le bouton Actualiser
  const handleRefreshCurrentTab = () => {
    lastToastErrorRef.current = null;
    loadPortalData();
    if (activeTab === 'resultats') {
      loadResults();
    } else if (activeTab === 'emploi_du_temps') {
      loadStudentTimetable();
    } else if (activeTab === 'devoirs') {
      loadStudentHomework();
    }
  };

  // 4. Téléchargement Sécurisé du Bulletin PDF Officiel
  const handleDownloadOfficialReportCard = async () => {
    if (!officialReportCard?.pdf_storage_path || isDownloadingPdf || !studentRecord) return;

    setIsDownloadingPdf(true);
    try {
      const selectedPeriod = calendarPeriods.find(p => p.id === selectedPeriodId);
      const periodLabel = selectedPeriod?.name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Periode';
      const cleanStudentName = `${studentRecord.first_name}_${studentRecord.last_name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Bulletin_${cleanStudentName}_${periodLabel}.pdf`;

      await downloadReportCardPdfBlob(officialReportCard.pdf_storage_path, filename);
      showToast('Téléchargement du bulletin officiel lancé avec succès.', 'success');
    } catch (err: any) {
      console.error('[RealStudentPortal] Erreur téléchargement PDF:', err);
      showToast(err.message || 'Impossible de télécharger le bulletin PDF officiel.', 'warning');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // 5. Consultation du détail des évaluations par matière
  const handleOpenSubjectDetail = async (subject: PeriodResultSubject) => {
    if (!studentRecord?.id || !selectedPeriodId) return;

    setSelectedSubjectDetail({
      subject,
      assessments: [],
      loading: true
    });

    try {
      const { data: rawData, error } = await supabase.rpc('get_student_subject_period_result', {
        p_student_id: studentRecord.id,
        p_subject_id: subject.subject_id,
        p_period_id: selectedPeriodId
      });

      if (error) throw error;

      const resData = Array.isArray(rawData) ? rawData[0] : rawData;

      setSelectedSubjectDetail({
        subject,
        assessments: resData?.assessments || [],
        loading: false
      });
    } catch (err: any) {
      console.error('[RealStudentPortal] Erreur détail matière:', err);
      notifyErrorOnce(err.message || 'Erreur lors du chargement du détail des notes.');
      setSelectedSubjectDetail(null);
    }
  };

  const selectedPeriodObj = calendarPeriods.find(p => p.id === selectedPeriodId);

  // Jour actuel pour mise en valeur (1 = Lundi, ..., 6 = Samedi, 7 = Dimanche)
  const currentDayOfWeek = (() => {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  })();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement de votre Espace Élève...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row antialiased selection:bg-amber-500 selection:text-slate-950">
      {/* Sidebar Vertical */}
      <StudentPortalSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpenMobile={isOpenMobile}
        onCloseMobile={() => setIsOpenMobile(false)}
        schoolName={school?.name}
        studentName={timetableData?.student_name || (profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : undefined)}
        studentNumber={timetableData?.student_number || studentRecord?.student_number}
        className={timetableData?.class_name || classInfo?.name}
        academicYearName={timetableData?.academic_year_name || classInfo?.academic_year_name}
        onSignOut={signOutReal}
        onRefresh={handleRefreshCurrentTab}
      />

      {/* Main Area Shell */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 min-h-screen">
        {/* Structured White Top Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsOpenMobile(true)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Ouvrir le menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-extrabold text-slate-900 truncate">
                  {school?.name || 'ÉcoleConnect'}
                </h1>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full text-[10px] font-extrabold shrink-0">
                  Espace Élève
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium truncate">
                Élève : <strong className="text-slate-900">{timetableData?.student_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`}</strong>
                {(timetableData?.student_number || studentRecord?.student_number) ? ` • Matricule : ${timetableData?.student_number || studentRecord?.student_number}` : ''}
                {(timetableData?.class_name || classInfo?.name) ? ` • Classe : ${timetableData?.class_name || classInfo?.name}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRefreshCurrentTab}
              className="p-2 sm:px-3 sm:py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl border border-slate-200 text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer"
              title="Actualiser les données"
            >
              <RefreshCw className="w-4 h-4 text-amber-600" />
              <span className="hidden sm:inline">Actualiser</span>
            </button>
            <button
              type="button"
              onClick={signOutReal}
              className="p-2 sm:px-3 sm:py-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-700 rounded-xl border border-slate-200 text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer"
              title="Se déconnecter"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">

          {/* ================================================================== */}
          {/* ONGLET 1 : RÉSULTATS & BULLETINS                                  */}
          {/* ================================================================== */}
          {activeTab === 'resultats' && (
            <>
              {/* Page Title Banner */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    Résultats & Notes scolaires
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                    Consultez vos résultats, vos évaluations et votre bulletin scolaire officiel.
                    {school?.name ? ` — ${school.name}` : ''}
                    {classInfo?.name ? ` (${classInfo.name})` : ''}
                  </p>
                </div>
              </div>

              {/* Error Notification if any */}
              {portalError && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs flex items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span><strong>Information :</strong> {portalError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshCurrentTab}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold rounded-xl text-xs cursor-pointer transition-colors shadow-xs"
                  >
                    Réessayer
                  </button>
                </div>
              )}

              {/* Period Selector Card */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-base font-extrabold text-slate-900">Période Scolaire & Trimestres</h2>
                    <p className="text-xs text-slate-500 font-medium">
                      {selectedPeriodObj
                        ? selectedPeriodObj.parent_term_name && typeof selectedPeriodObj.parent_term_name === 'string' && selectedPeriodObj.parent_term_name.trim()
                          ? `Période active : ${selectedPeriodObj.name} (${selectedPeriodObj.parent_term_name.trim()})`
                          : `Période active : ${selectedPeriodObj.name}`
                        : 'Sélectionnez une période d’évaluation ci-contre.'}
                    </p>
                  </div>
                </div>

                <div className="w-full md:w-80">
                  <label htmlFor="period-select" className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1">
                    Sélecteur de Période Scolaire
                  </label>
                  <select
                    id="period-select"
                    aria-label="Période Scolaire"
                    value={selectedPeriodId}
                    onChange={e => setSelectedPeriodId(e.target.value)}
                    disabled={calendarPeriods.length === 0}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {calendarPeriods.length === 0 ? (
                      <option value="">Aucune période disponible</option>
                    ) : (
                      calendarPeriods.map(p => {
                        const cleanTerm = p.parent_term_name && typeof p.parent_term_name === 'string' ? p.parent_term_name.trim() : '';
                        const termStr = cleanTerm ? ` — ${cleanTerm}` : '';
                        const dateStr = p.starts_on && p.ends_on ? ` (${p.starts_on} au ${p.ends_on})` : '';
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name}{termStr}{dateStr}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>
              </div>

              {/* Official Report Card Download Banner */}
              {officialReportCard && (
                <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 text-white rounded-3xl border border-amber-500/30 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                      <FileCheck className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                          Bulletin Officiel Certifié Disponible
                        </span>
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-bold flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          Signé & Scellé
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 font-medium">
                        {officialReportCard.rank ? (
                          <span>Votre rang officiel : <strong className="text-white font-mono font-black">#{officialReportCard.rank}</strong> • </span>
                        ) : null}
                        Document conforme avec cachet de l'école et signatures de la direction.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isDownloadingPdf}
                    onClick={handleDownloadOfficialReportCard}
                    className="w-full md:w-auto px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-500/10 transition-colors disabled:opacity-50 shrink-0"
                  >
                    <Download className={`w-4 h-4 ${isDownloadingPdf ? 'animate-bounce' : ''}`} />
                    <span>{isDownloadingPdf ? 'Téléchargement...' : 'Télécharger le Bulletin (PDF)'}</span>
                  </button>
                </div>
              )}

              {/* Results Body */}
              {calendarPeriods.length === 0 ? (
                <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-4 shadow-xs">
                  <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto">
                    <Clock className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-extrabold text-slate-900">Calendrier Scolaire en attente</h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto font-medium">
                      {portalError || "Le calendrier scolaire de votre cycle n’est pas encore activé par l’établissement."}
                    </p>
                  </div>
                </div>
              ) : loadingResults ? (
                <div className="p-16 text-center text-slate-500 space-y-3 bg-white rounded-3xl border border-slate-200 shadow-xs">
                  <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs font-bold">Calcul de vos résultats officiels en cours...</p>
                </div>
              ) : !periodResult ? (
                <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-3 shadow-xs">
                  <Award className="w-12 h-12 text-slate-400 mx-auto" />
                  <h3 className="text-sm font-extrabold text-slate-900">Aucun résultat publié</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto font-medium">
                    Les évaluations de cette période n'ont pas encore été clôturées ou publiées par l'établissement.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Overall Percentage Card */}
                  <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                            {periodResult.student_number}
                          </span>
                          <h2 className="text-xl font-extrabold text-slate-900">{periodResult.student_name}</h2>
                        </div>
                        <p className="text-xs text-slate-500 font-medium">
                          Classe : <strong className="text-slate-800">{periodResult.class_name}</strong> • {periodResult.period_name}
                          {periodResult.term_name && typeof periodResult.term_name === 'string' && periodResult.term_name.trim()
                            ? ` (${periodResult.term_name.trim()})`
                            : ''}
                        </p>
                      </div>

                      <div className="bg-slate-900 text-white px-6 py-4 rounded-3xl text-right space-y-1 w-full sm:w-auto shadow-sm">
                        <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                          Votre Pourcentage Général
                        </span>
                        <p className="text-3xl font-black text-amber-400">
                          {periodResult.overall_percentage !== null ? `${periodResult.overall_percentage} %` : 'En cours'}
                        </p>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${
                          periodResult.is_complete
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}>
                          {periodResult.is_complete ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              Résultats Complets
                            </>
                          ) : (
                            <>
                              <Clock className="w-3 h-3 text-amber-400" />
                              Évaluations en attente
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    {!periodResult.is_complete && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs flex items-center gap-2 font-medium">
                        <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                        <span>
                          {officialReportCard ? (
                            "Ce bulletin officiel a été publié avec des matières en attente. Toute correction ultérieure fera l’objet d’une nouvelle révision."
                          ) : (
                            "Certaines notes sont encore en attente de publication. Votre moyenne sera actualisée automatiquement."
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Subjects Table */}
                  <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
                    <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                      <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-amber-600" />
                        Vos Matières ({periodResult.subjects.length})
                      </h3>
                    </div>

                    <div className="overflow-x-auto scrollbar-thin">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500 font-extrabold uppercase tracking-wider text-[11px] border-b border-slate-200">
                          <tr>
                            <th className="px-6 py-4">Matière</th>
                            <th className="px-6 py-4 text-center">Coefficient</th>
                            <th className="px-6 py-4 text-center">Évaluations</th>
                            <th className="px-6 py-4 text-center">Votre Moyenne</th>
                            <th className="px-6 py-4 text-center">Statut</th>
                            <th className="px-6 py-4 text-right">Détail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {periodResult.subjects.map(sbj => (
                            <tr key={sbj.subject_id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-6 py-4 font-bold text-slate-900 flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 font-bold text-xs shrink-0">
                                  {sbj.subject_name.charAt(0).toUpperCase()}
                                </div>
                                <span className="truncate">{sbj.subject_name}</span>
                              </td>
                              <td className="px-6 py-4 text-center font-bold text-amber-700">
                                {sbj.subject_coefficient}
                              </td>
                              <td className="px-6 py-4 text-center text-slate-600 font-medium">
                                {sbj.completed_assessment_count} / {sbj.assessment_count}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {sbj.subject_percentage !== null ? (
                                  <span
                                    className={`inline-flex items-center px-3 py-1 rounded-xl font-black text-xs ${
                                      sbj.subject_percentage >= 70
                                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                                        : sbj.subject_percentage >= 50
                                        ? 'bg-amber-50 border border-amber-200 text-amber-800'
                                        : 'bg-rose-50 border border-rose-200 text-rose-800'
                                    }`}
                                  >
                                    {sbj.subject_percentage} %
                                  </span>
                                ) : (
                                  <span className="text-slate-400 italic">En attente</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {sbj.is_complete ? (
                                  <span className="text-emerald-700 font-bold text-[11px]">Complet</span>
                                ) : (
                                  <span className="text-amber-700 font-bold text-[11px]">En cours</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleOpenSubjectDetail(sbj)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                                >
                                  <Eye className="w-3.5 h-3.5 text-amber-600" />
                                  Voir Notes
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ================================================================== */}
          {/* ONGLET 2 : EMPLOI DU TEMPS (Phase 2K-T6-F)                        */}
          {/* ================================================================== */}
          {activeTab === 'emploi_du_temps' && (
            <div className="space-y-6">
              {/* Page Title & Header Card */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-7 h-7 text-amber-600 shrink-0" />
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                      Emploi du temps
                    </h1>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
                    {school?.name || 'Établissement'}
                    {timetableData?.class_name ? ` • Classe : ${timetableData.class_name}` : classInfo?.name ? ` • Classe : ${classInfo.name}` : ''}
                    {timetableData?.academic_year_name ? ` (${timetableData.academic_year_name})` : classInfo?.academic_year_name ? ` (${classInfo.academic_year_name})` : ''}
                  </p>
                </div>

                {/* Summary Badges */}
                {timetableData && (
                  <div className="flex items-center gap-2 self-stretch sm:self-auto">
                    <span className="px-3.5 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                      <Clock className="w-4 h-4 text-amber-600" />
                      {timetableData.summary.total_slots} créneaux
                    </span>
                    <span className="px-3.5 py-1.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                      <Calendar className="w-4 h-4 text-indigo-600" />
                      {timetableData.summary.total_days} jours de cours
                    </span>
                  </div>
                )}
              </div>

              {/* State 1: Loading State */}
              {loadingTimetable ? (
                <div className="p-16 text-center text-slate-500 space-y-3 bg-white rounded-3xl border border-slate-200 shadow-xs">
                  <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs font-bold text-slate-700">Chargement de votre emploi du temps sécurisé...</p>
                </div>
              ) : timetableError ? (
                /* State 2: Error State (Access denied, Network, Malformed) */
                <div className="p-8 bg-amber-50 border border-amber-200 rounded-3xl text-amber-950 space-y-4 shadow-xs">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-sm font-extrabold">Impossible d'afficher l'emploi du temps</h3>
                      <p className="text-xs text-amber-800 font-medium">{timetableError}</p>
                    </div>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={loadStudentTimetable}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold rounded-xl text-xs cursor-pointer transition-colors shadow-xs flex items-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Réessayer</span>
                    </button>
                  </div>
                </div>
              ) : !timetableData || timetableData.slots.length === 0 ? (
                /* State 3: Empty State */
                <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-4 shadow-xs">
                  <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto">
                    <Calendar className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-extrabold text-slate-900">Aucun créneau configuré</h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto font-medium">
                      L'emploi du temps de votre classe n'a pas encore été publié pour l'année académique en cours.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadStudentTimetable}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl cursor-pointer transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                    <span>Actualiser</span>
                  </button>
                </div>
              ) : (
                /* State 4: Timetable Content (Desktop & Mobile) */
                <div className="space-y-8">
                  {/* Desktop Grid (Hidden on Mobile) */}
                  <div className="hidden lg:grid grid-cols-6 gap-4">
                    {DAYS_MAP.map(day => {
                      const daySlots = timetableData.slots
                        .filter(s => s.day_of_week === day.day_of_week)
                        .sort((a, b) => a.start_time.localeCompare(b.start_time));

                      const isCurrentDay = currentDayOfWeek === day.day_of_week;

                      return (
                        <div
                          key={day.day_of_week}
                          className={`flex flex-col rounded-3xl border transition-all ${
                            isCurrentDay
                              ? 'bg-white border-amber-400 shadow-md ring-2 ring-amber-400/20'
                              : 'bg-white border-slate-200 shadow-xs'
                          }`}
                        >
                          {/* Day Column Header */}
                          <div
                            className={`p-3.5 text-center border-b font-extrabold text-xs rounded-t-3xl ${
                              isCurrentDay
                                ? 'bg-amber-500 text-slate-950 border-amber-400'
                                : 'bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                          >
                            <span>{day.day_name}</span>
                            {isCurrentDay && (
                              <span className="block text-[9px] uppercase tracking-wider font-black text-slate-950/80 mt-0.5">
                                Aujourd'hui
                              </span>
                            )}
                          </div>

                          {/* Day Slots List */}
                          <div className="p-3 space-y-3 flex-1">
                            {daySlots.length === 0 ? (
                              <div className="h-full min-h-[120px] flex items-center justify-center text-center p-2">
                                <span className="text-[11px] text-slate-400 font-medium italic">Pas de cours</span>
                              </div>
                            ) : (
                              daySlots.map((slot, idx) => {
                                const isBreak = slot.slot_type === 'break';
                                return (
                                  <div
                                    key={idx}
                                    className={`p-3 rounded-2xl border transition-all space-y-1.5 ${
                                      isBreak
                                        ? 'bg-amber-50/80 border-amber-200/90 text-amber-950'
                                        : 'bg-slate-50/90 border-slate-200/80 text-slate-900 hover:border-slate-300'
                                    }`}
                                  >
                                    {/* Slot Hours */}
                                    <div className="flex items-center justify-between gap-1 text-[10px] font-mono font-bold text-slate-500">
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                                        {slot.start_time} - {slot.end_time}
                                      </span>
                                      {isBreak && (
                                        <span className="px-1.5 py-0.5 bg-amber-200/60 text-amber-900 rounded-md font-extrabold text-[9px] uppercase tracking-wider">
                                          Pause
                                        </span>
                                      )}
                                    </div>

                                    {/* Subject / Break Label */}
                                    <p className={`text-xs font-extrabold leading-snug ${isBreak ? 'text-amber-900' : 'text-slate-900'}`}>
                                      {isBreak ? (slot.label || slot.subject_name || 'Pause') : slot.subject_name}
                                    </p>

                                    {/* Course Metadata (Teacher & Room) */}
                                    {!isBreak && (
                                      <div className="space-y-1 pt-1 border-t border-slate-200/60 text-[11px]">
                                        {slot.teacher_name && (
                                          <div className="flex items-center gap-1 text-slate-600 truncate">
                                            <User className="w-3 h-3 text-amber-600 shrink-0" />
                                            <span className="truncate">{slot.teacher_name}</span>
                                          </div>
                                        )}
                                        {slot.room && (
                                          <div className="flex items-center gap-1 text-slate-500 truncate font-medium">
                                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                                            <span className="truncate">{slot.room}</span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Mobile Grouped Cards (Visible on Mobile/Tablet) */}
                  <div className="lg:hidden space-y-4">
                    {DAYS_MAP.map(day => {
                      const daySlots = timetableData.slots
                        .filter(s => s.day_of_week === day.day_of_week)
                        .sort((a, b) => a.start_time.localeCompare(b.start_time));

                      if (daySlots.length === 0) return null;

                      const isCurrentDay = currentDayOfWeek === day.day_of_week;

                      return (
                        <div
                          key={day.day_of_week}
                          className={`bg-white rounded-3xl border overflow-hidden shadow-xs ${
                            isCurrentDay ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'
                          }`}
                        >
                          {/* Day Header Mobile */}
                          <div
                            className={`px-4 py-3 font-extrabold text-xs flex items-center justify-between ${
                              isCurrentDay
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            <span className="text-sm font-black">{day.day_name}</span>
                            <span className="text-[11px] font-mono">
                              {daySlots.length} créneau{daySlots.length > 1 ? 'x' : ''}
                            </span>
                          </div>

                          {/* Day Slots List Mobile */}
                          <div className="p-3 divide-y divide-slate-100 space-y-2">
                            {daySlots.map((slot, idx) => {
                              const isBreak = slot.slot_type === 'break';
                              return (
                                <div
                                  key={idx}
                                  className={`p-3.5 rounded-2xl border pt-3 transition-all ${
                                    isBreak
                                      ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                                      : 'bg-slate-50/80 border-slate-200 text-slate-900'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      {isBreak ? (
                                        <Coffee className="w-4 h-4 text-amber-600 shrink-0" />
                                      ) : (
                                        <BookOpen className="w-4 h-4 text-amber-600 shrink-0" />
                                      )}
                                      <span className="font-black text-xs text-slate-900">
                                        {isBreak ? (slot.label || slot.subject_name || 'Pause') : slot.subject_name}
                                      </span>
                                    </div>

                                    <span className="px-2.5 py-1 bg-slate-900 text-white font-mono text-[10px] font-bold rounded-lg shrink-0">
                                      {slot.start_time} - {slot.end_time}
                                    </span>
                                  </div>

                                  {!isBreak && (
                                    <div className="mt-2.5 pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-600">
                                      <span className="font-bold truncate">{slot.teacher_name}</span>
                                      {slot.room && (
                                        <span className="px-2 py-0.5 bg-slate-200 text-slate-800 rounded-md font-extrabold text-[10px] shrink-0">
                                          {slot.room}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================== */}
          {/* ONGLET 3 : DEVOIRS & CAHIER DE TEXTE (Phase 2K-T7-F)               */}
          {/* ================================================================== */}
          {activeTab === 'devoirs' && (
            <div className="space-y-6">
              {/* Page Title & Header Card */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-7 h-7 text-amber-600 shrink-0" />
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                      Devoirs & Cahier de texte
                    </h1>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
                    {school?.name || 'Établissement'}
                    {homeworkData?.class_name ? ` • Classe : ${homeworkData.class_name}` : classInfo?.name ? ` • Classe : ${classInfo.name}` : ''}
                    {homeworkData?.academic_year_name ? ` (${homeworkData.academic_year_name})` : classInfo?.academic_year_name ? ` (${classInfo.academic_year_name})` : ''}
                  </p>
                </div>

                {/* Summary Badges */}
                {homeworkData && (
                  <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
                    <span className="px-3.5 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                      <BookOpen className="w-4 h-4 text-amber-600" />
                      {homeworkData.summary.total} devoir{homeworkData.summary.total > 1 ? 's' : ''} au total
                    </span>
                    <span className="px-3.5 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      {homeworkData.summary.open} ouvert{homeworkData.summary.open > 1 ? 's' : ''}
                    </span>
                    <span className="px-3.5 py-1.5 bg-slate-100 text-slate-700 border border-slate-300 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                      <Clock className="w-4 h-4 text-slate-500" />
                      {homeworkData.summary.closed} clôturé{homeworkData.summary.closed > 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>

              {/* State 1: Loading State */}
              {loadingHomework ? (
                <div className="p-16 text-center text-slate-500 space-y-3 bg-white rounded-3xl border border-slate-200 shadow-xs">
                  <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-xs font-bold text-slate-700">Chargement de vos devoirs sécurisés...</p>
                </div>
              ) : homeworkError ? (
                /* State 2: Error State (Access denied 42501, Network, Malformed) */
                <div className="p-8 bg-amber-50 border border-amber-200 rounded-3xl text-amber-950 space-y-4 shadow-xs">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-sm font-extrabold">Impossible d'afficher les devoirs</h3>
                      <p className="text-xs text-amber-800 font-medium">{homeworkError}</p>
                    </div>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={loadStudentHomework}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold rounded-xl text-xs cursor-pointer transition-colors shadow-xs flex items-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Réessayer</span>
                    </button>
                  </div>
                </div>
              ) : !homeworkData || homeworkData.homework.length === 0 ? (
                /* State 3: Empty State */
                <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-4 shadow-xs">
                  <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto">
                    <ClipboardCheck className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-extrabold text-slate-900">Aucun devoir publié pour le moment</h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto font-medium">
                      Les enseignants n'ont publié aucun devoir pour votre classe pour l'année académique en cours.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadStudentHomework}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl cursor-pointer transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                    <span>Actualiser</span>
                  </button>
                </div>
              ) : (
                /* State 4: Homework List Content with Filters */
                <div className="space-y-6">
                  {/* Filter Pills Bar */}
                  {(() => {
                    const allItems = homeworkData.homework;
                    const upcomingCount = allItems.filter(i => computeHomeworkStatus(i) === 'upcoming').length;
                    const dueTodayCount = allItems.filter(i => computeHomeworkStatus(i) === 'due_today').length;
                    const overdueCount = allItems.filter(i => computeHomeworkStatus(i) === 'overdue').length;
                    const closedCount = allItems.filter(i => computeHomeworkStatus(i) === 'closed').length;

                    const filteredHomework = allItems.filter(item => {
                      const st = computeHomeworkStatus(item);
                      if (homeworkFilter === 'all') return true;
                      if (homeworkFilter === 'upcoming') return st === 'upcoming';
                      if (homeworkFilter === 'due_today') return st === 'due_today';
                      if (homeworkFilter === 'overdue') return st === 'overdue';
                      if (homeworkFilter === 'closed') return st === 'closed';
                      return true;
                    });

                    const filters: Array<{ id: HomeworkFilter; label: string; count: number }> = [
                      { id: 'all', label: 'Tous', count: allItems.length },
                      { id: 'upcoming', label: 'À venir', count: upcomingCount },
                      { id: 'due_today', label: 'Aujourd’hui', count: dueTodayCount },
                      { id: 'overdue', label: 'En retard', count: overdueCount },
                      { id: 'closed', label: 'Clôturés', count: closedCount }
                    ];

                    return (
                      <>
                        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
                          {filters.map(f => {
                            const isActive = homeworkFilter === f.id;
                            return (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => setHomeworkFilter(f.id)}
                                className={`px-4 py-2 rounded-2xl text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                                  isActive
                                    ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                <span>{f.label}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                                  isActive ? 'bg-slate-950 text-amber-400' : 'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}>
                                  {f.count}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Homework Cards Grid */}
                        {filteredHomework.length === 0 ? (
                          <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-3 shadow-xs">
                            <ClipboardCheck className="w-10 h-10 text-slate-400 mx-auto" />
                            <h3 className="text-sm font-extrabold text-slate-900">Aucun devoir dans cette catégorie</h3>
                            <p className="text-xs text-slate-500 max-w-sm mx-auto font-medium">
                              Aucun devoir ne correspond au filtre sélectionné.
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                            {filteredHomework.map((hw, idx) => {
                              const temporalStatus = computeHomeworkStatus(hw);

                              let badgeBg = 'bg-indigo-50 text-indigo-800 border-indigo-200';
                              let badgeLabel = 'À venir';
                              if (temporalStatus === 'closed') {
                                badgeBg = 'bg-slate-200 text-slate-800 border-slate-300';
                                badgeLabel = 'Clôturé';
                              } else if (temporalStatus === 'overdue') {
                                badgeBg = 'bg-rose-100 text-rose-900 border-rose-300';
                                badgeLabel = 'En retard';
                              } else if (temporalStatus === 'due_today') {
                                badgeBg = 'bg-amber-100 text-amber-900 border-amber-300';
                                badgeLabel = 'Aujourd’hui';
                              }

                              return (
                                <div
                                  key={idx}
                                  className={`flex flex-col justify-between p-5 rounded-3xl border transition-all ${
                                    hw.is_closed
                                      ? 'bg-slate-50/90 border-slate-200/90 opacity-80'
                                      : temporalStatus === 'overdue'
                                      ? 'bg-white border-rose-300 shadow-sm ring-1 ring-rose-300/30'
                                      : temporalStatus === 'due_today'
                                      ? 'bg-white border-amber-400 shadow-sm ring-1 ring-amber-400/30'
                                      : 'bg-white border-slate-200 shadow-xs hover:border-slate-300'
                                  }`}
                                >
                                  {/* Card Header: Subject & Status Badge */}
                                  <div className="space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="px-3 py-1 bg-amber-50 text-amber-900 border border-amber-200 rounded-xl text-xs font-black truncate max-w-[70%]">
                                        {hw.subject_name}
                                      </span>
                                      <span className={`px-2.5 py-1 rounded-xl border text-[10px] font-extrabold uppercase tracking-wider shrink-0 ${badgeBg}`}>
                                        {badgeLabel}
                                      </span>
                                    </div>

                                    {/* Title */}
                                    <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                                      {hw.title}
                                    </h3>

                                    {/* Instructions */}
                                    {hw.instructions ? (
                                      <p className="text-xs text-slate-600 font-medium whitespace-pre-wrap leading-relaxed line-clamp-4 bg-slate-50/80 p-3 rounded-2xl border border-slate-100">
                                        {hw.instructions}
                                      </p>
                                    ) : null}
                                  </div>

                                  {/* Card Footer: Metadata */}
                                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-500 font-medium">
                                    <div className="flex items-center gap-1.5 text-slate-700 truncate">
                                      <User className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                      <span className="truncate">{hw.teacher_name}</span>
                                    </div>

                                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1">
                                      {hw.assigned_on ? (
                                        <span>Donné le : <strong className="text-slate-700">{formatHomeworkAssignedDate(hw.assigned_on)}</strong></span>
                                      ) : <span />}

                                      {hw.due_at ? (
                                        <span className="font-mono font-bold text-slate-900">
                                          À rendre le : {formatHomeworkDueDate(hw.due_at)}
                                        </span>
                                      ) : null}
                                    </div>

                                    {hw.estimated_minutes !== null && (
                                      <div className="text-[11px] text-amber-800 font-extrabold flex items-center gap-1">
                                        <Clock className="w-3 h-3 text-amber-600" />
                                        <span>Durée estimée : {hw.estimated_minutes} min</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

        </main>
      </div>

      {/* Subject Assessments Detail Modal */}
      {selectedSubjectDetail && (
        <Modal
          isOpen={!!selectedSubjectDetail}
          onClose={() => setSelectedSubjectDetail(null)}
          title={`Vos Évaluations : ${selectedSubjectDetail.subject.subject_name}`}
        >
          {selectedSubjectDetail.loading ? (
            <div className="p-12 text-center text-slate-500 space-y-3">
              <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-bold">Chargement des évaluations...</p>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex justify-between items-center">
                <div>
                  <p className="text-slate-600">Matière : <strong className="text-slate-900">{selectedSubjectDetail.subject.subject_name}</strong></p>
                  <p className="text-slate-600 mt-0.5">Coefficient : <strong className="text-amber-700">{selectedSubjectDetail.subject.subject_coefficient}</strong></p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 font-bold uppercase block">Moyenne Matière</span>
                  <span className="text-xl font-black text-amber-700">
                    {selectedSubjectDetail.subject.subject_percentage !== null ? `${selectedSubjectDetail.subject.subject_percentage} %` : 'En attente'}
                  </span>
                </div>
              </div>

              {/* Assessment list */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {selectedSubjectDetail.assessments.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 font-medium">
                    Aucune évaluation publiée pour cette matière.
                  </div>
                ) : (
                  selectedSubjectDetail.assessments.map((asmt: any, idx: number) => (
                    <div key={asmt.assessment_id || idx} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-extrabold text-slate-900 text-xs">{asmt.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 font-medium">
                            Date : {asmt.assessment_date} • Coeff évaluation : {asmt.coefficient}
                          </p>
                        </div>

                        {/* Result Score / Absence */}
                        <div className="text-right">
                          {asmt.is_absent ? (
                            asmt.is_excused ? (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 border border-emerald-200 text-emerald-800 block">
                                Absence Excusée
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 border border-rose-200 text-rose-800 block">
                                Absence non justifiée (0 %)
                              </span>
                            )
                          ) : asmt.score !== null && asmt.score !== undefined ? (
                            <div>
                              <span className="text-base font-black text-slate-900">
                                {asmt.score} <span className="text-xs text-slate-500">/ {asmt.max_score}</span>
                              </span>
                              <span className="text-xs font-bold text-amber-700 block">
                                ({asmt.normalized_percentage} %)
                              </span>
                            </div>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 border border-amber-200 text-amber-800 block">
                              En attente
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Comment */}
                      {asmt.teacher_comment && (
                        <p className="text-[11px] text-slate-600 italic bg-white p-2 rounded-lg border border-slate-200">
                          « {asmt.teacher_comment} »
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedSubjectDetail(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};
