// Fichier : src/pages/student/RealStudentPortal.tsx
// Portail Élève Réel : Consultation officielle des résultats et téléchargement du bulletin PDF (Phase 2F.3C)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { Logo } from '../../components/common/Logo';
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
  ShieldCheck
} from 'lucide-react';
import { downloadReportCardPdfBlob, isPublishedPdfMetadataComplete } from '../../services/reportCardPdfService.ts';
import { buildGetSchoolCalendarParams, extractAndSortCalendarPeriods } from '../../services/calendarService.ts';

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

export const RealStudentPortal: React.FC = () => {
  const { profile, school, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState<boolean>(true);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [studentRecord, setStudentRecord] = useState<StudentRecord | null>(null);
  const [_classInfo, setClassInfo] = useState<{
    id: string;
    name: string;
    education_cycle: string;
    academic_year_id: string;
  } | null>(null);

  // Calendar
  const [calendarPeriods, setCalendarPeriods] = useState<any[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');

  // Results & Official Report Card (Phase 2F.3C)
  const [loadingResults, setLoadingResults] = useState<boolean>(false);
  const [periodResult, setPeriodResult] = useState<StudentPeriodResult | null>(null);
  const [officialReportCard, setOfficialReportCard] = useState<OfficialStudentReportCard | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

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
      setClassInfo({
        id: cl.id,
        name: cl.name,
        education_cycle: cl.education_cycle,
        academic_year_id: cl.academic_year_id
      });

      // 1.3 Charger le calendrier scolaire officiel avec paramètres stricts et extraction robuste
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

  // 2. Chargement des résultats académiques et vérification du bulletin officiel publié (Phase 2F.3C)
  const loadResults = useCallback(async () => {
    if (!studentRecord?.id || !selectedPeriodId) {
      setPeriodResult(null);
      setOfficialReportCard(null);
      return;
    }

    setLoadingResults(true);
    try {
      // 2.1 Charger les résultats de la période
      const { data: rawData, error } = await supabase.rpc('get_student_period_result', {
        p_student_id: studentRecord.id,
        p_period_id: selectedPeriodId
      });

      if (error) {
        console.error('[RealStudentPortal] Erreur get_student_period_result:', error);
      }

      const resData = Array.isArray(rawData) ? rawData[0] : rawData;
      setPeriodResult(resData ? (resData as StudentPeriodResult) : null);

      // 2.2 Vérifier s'il existe un bulletin officiel publié via RLS
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
  }, [studentRecord?.id, selectedPeriodId]);

  useEffect(() => {
    if (studentRecord?.id && selectedPeriodId) {
      loadResults();
    } else {
      setPeriodResult(null);
      setOfficialReportCard(null);
    }
  }, [studentRecord?.id, selectedPeriodId, loadResults]);

  // 3. Téléchargement Sécurisé du Bulletin PDF Officiel (Phase 2F.3C)
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

  // 4. Consultation du détail des évaluations par matière
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement de votre Espace Élève...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Header Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-indigo-400 uppercase tracking-wider">{school?.name || 'ÉcoleConnect'}</span>
              <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-bold">
                Espace Numérique Élève
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Élève : <strong className="text-white">{profile?.first_name} {profile?.last_name}</strong> {studentRecord?.student_number ? `(${studentRecord.student_number})` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              lastToastErrorRef.current = null;
              loadPortalData();
            }}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="Actualiser les résultats"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={signOutReal}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="Se déconnecter"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Error Notification if any */}
        {portalError && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
              <span><strong>Information :</strong> {portalError}</span>
            </div>
            <button
              onClick={() => {
                lastToastErrorRef.current = null;
                loadPortalData();
              }}
              className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs cursor-pointer"
            >
              Réessayer
            </button>
          </div>
        )}

        {/* Selector Bar */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Résultats & Notes Scolaires</h2>
              <p className="text-xs text-slate-400">
                Consultez vos pourcentages et téléchargez votre bulletin scolaire officiel publié.
              </p>
            </div>
          </div>

          <div className="w-full md:w-80">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Période Scolaire
            </label>
            <select
              value={selectedPeriodId}
              onChange={e => setSelectedPeriodId(e.target.value)}
              disabled={calendarPeriods.length === 0}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold disabled:opacity-50"
            >
              {calendarPeriods.length === 0 ? (
                <option value="">Aucune période disponible</option>
              ) : (
                calendarPeriods.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.parent_term_name} {p.starts_on && p.ends_on ? `(${p.starts_on} au ${p.ends_on})` : ''}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Official Report Card Download Banner (Phase 2F.3C) */}
        {officialReportCard && (
          <div className="p-6 bg-gradient-to-r from-amber-500/20 via-slate-900 to-indigo-950/40 rounded-3xl border border-amber-500/40 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
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
                <p className="text-xs text-slate-300">
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
              className="w-full md:w-auto px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-500/10 transition-colors disabled:opacity-50"
            >
              <Download className={`w-4 h-4 ${isDownloadingPdf ? 'animate-bounce' : ''}`} />
              <span>{isDownloadingPdf ? 'Téléchargement...' : 'Télécharger le Bulletin (PDF)'}</span>
            </button>
          </div>
        )}

        {/* Results Body */}
        {calendarPeriods.length === 0 ? (
          <div className="p-12 text-center bg-slate-900/90 rounded-3xl border border-slate-800 space-y-4 shadow-xl backdrop-blur-xl">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
              <Clock className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Calendrier Scolaire en attente</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                {portalError || "Le calendrier scolaire de votre cycle n’est pas encore activé par l’établissement."}
              </p>
            </div>
          </div>
        ) : loadingResults ? (
          <div className="p-16 text-center text-slate-400 space-y-3">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold">Calcul de vos résultats officiels...</p>
          </div>
        ) : !periodResult ? (
          <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
            <Award className="w-12 h-12 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-white">Aucun résultat publié</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Les évaluations de cette période n'ont pas encore été clôturées ou publiées par l'établissement.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Overall Percentage Card */}
            <div className="p-6 bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 rounded-3xl border border-indigo-500/30 shadow-2xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                      {periodResult.student_number}
                    </span>
                    <h2 className="text-xl font-black text-white">{periodResult.student_name}</h2>
                  </div>
                  <p className="text-xs text-slate-400">
                    Classe : <strong className="text-slate-200">{periodResult.class_name}</strong> • {periodResult.period_name} ({periodResult.term_name})
                  </p>
                </div>

                <div className="bg-slate-950/90 px-6 py-4 rounded-3xl border border-slate-800 text-right space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Votre Pourcentage Général
                  </span>
                  <p className="text-3xl font-black text-amber-400">
                    {periodResult.overall_percentage !== null ? `${periodResult.overall_percentage} %` : 'En cours'}
                  </p>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    periodResult.is_complete
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    {periodResult.is_complete ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        Résultats Complets
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3" />
                        Évaluations en attente
                      </>
                    )}
                  </span>
                </div>
              </div>

              {!periodResult.is_complete && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
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
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl backdrop-blur-xl">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-indigo-400" />
                  Vos Matières ({periodResult.subjects.length})
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-bold border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-4">Matière</th>
                      <th className="px-6 py-4 text-center">Coefficient</th>
                      <th className="px-6 py-4 text-center">Évaluations</th>
                      <th className="px-6 py-4 text-center">Votre Moyenne</th>
                      <th className="px-6 py-4 text-center">Statut</th>
                      <th className="px-6 py-4 text-right">Détail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {periodResult.subjects.map(sbj => (
                      <tr key={sbj.subject_id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-6 py-4 font-bold text-white flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs">
                            {sbj.subject_name.charAt(0).toUpperCase()}
                          </div>
                          <span>{sbj.subject_name}</span>
                        </td>
                        <td className="px-6 py-4 text-center font-bold text-amber-300">
                          {sbj.subject_coefficient}
                        </td>
                        <td className="px-6 py-4 text-center text-slate-300">
                          {sbj.completed_assessment_count} / {sbj.assessment_count}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {sbj.subject_percentage !== null ? (
                            <span
                              className={`inline-flex items-center px-3 py-1 rounded-xl font-black text-sm ${
                                sbj.subject_percentage >= 70
                                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                                  : sbj.subject_percentage >= 50
                                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
                                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                              }`}
                            >
                              {sbj.subject_percentage} %
                            </span>
                          ) : (
                            <span className="text-slate-500 italic">En attente</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {sbj.is_complete ? (
                            <span className="text-emerald-400 font-bold text-[11px]">Complet</span>
                          ) : (
                            <span className="text-amber-400 font-bold text-[11px]">En cours</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleOpenSubjectDetail(sbj)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                          >
                            <Eye className="w-3.5 h-3.5" />
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
      </main>

      {/* Subject Assessments Detail Modal */}
      {selectedSubjectDetail && (
        <Modal
          isOpen={!!selectedSubjectDetail}
          onClose={() => setSelectedSubjectDetail(null)}
          title={`Vos Évaluations : ${selectedSubjectDetail.subject.subject_name}`}
        >
          {selectedSubjectDetail.loading ? (
            <div className="p-12 text-center text-slate-400 space-y-3">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-bold">Chargement des évaluations...</p>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex justify-between items-center">
                <div>
                  <p className="text-slate-400">Matière : <strong className="text-indigo-400">{selectedSubjectDetail.subject.subject_name}</strong></p>
                  <p className="text-slate-400 mt-0.5">Coefficient de la matière : <strong className="text-amber-400">{selectedSubjectDetail.subject.subject_coefficient}</strong></p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Moyenne Matière</span>
                  <span className="text-xl font-black text-amber-400">
                    {selectedSubjectDetail.subject.subject_percentage !== null ? `${selectedSubjectDetail.subject.subject_percentage} %` : 'En attente'}
                  </span>
                </div>
              </div>

              {/* Assessment list */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {selectedSubjectDetail.assessments.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 bg-slate-950 rounded-xl border border-slate-800">
                    Aucune évaluation publiée pour cette matière.
                  </div>
                ) : (
                  selectedSubjectDetail.assessments.map((asmt: any, idx: number) => (
                    <div key={asmt.assessment_id || idx} className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-extrabold text-white text-xs">{asmt.title}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Date : {asmt.assessment_date} • Coeff évaluation : {asmt.coefficient}
                          </p>
                        </div>

                        {/* Result Score / Absence */}
                        <div className="text-right">
                          {asmt.is_absent ? (
                            asmt.is_excused ? (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 block">
                                Absence Excusée
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-500/10 border border-rose-500/30 text-rose-400 block">
                                Absence non justifiée (0 %)
                              </span>
                            )
                          ) : asmt.score !== null && asmt.score !== undefined ? (
                            <div>
                              <span className="text-base font-black text-white">
                                {asmt.score} <span className="text-xs text-slate-400">/ {asmt.max_score}</span>
                              </span>
                              <span className="text-xs font-bold text-amber-400 block">
                                ({asmt.normalized_percentage} %)
                              </span>
                            </div>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 border border-amber-500/30 text-amber-300 block">
                              En attente
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Comment */}
                      {asmt.teacher_comment && (
                        <p className="text-[11px] text-slate-400 italic bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
                          « {asmt.teacher_comment} »
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedSubjectDetail(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Footer */}
      <footer className="p-4 sm:p-6 border-t border-slate-900 text-center text-xs text-slate-500">
        ÉcoleConnect — Espace Numérique Élève
      </footer>
    </div>
  );
};
