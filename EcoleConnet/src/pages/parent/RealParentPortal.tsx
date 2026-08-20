// Fichier : src/pages/parent/RealParentPortal.tsx
// Portail Parent Réel : Consultation officielle des résultats et téléchargement du bulletin PDF (Phase 2F.3C)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { Logo } from '../../components/common/Logo';
import {
  Users,
  Award,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  LogOut,
  Eye,
  User,
  Download,
  FileCheck,
  ShieldCheck,
  DollarSign
} from 'lucide-react';
import { downloadReportCardPdfBlob, isPublishedPdfMetadataComplete } from '../../services/reportCardPdfService.ts';
import { buildGetSchoolCalendarParams, extractAndSortCalendarPeriods } from '../../services/calendarService.ts';
import { ParentFinanceModule } from '../../components/parent/ParentFinanceModule';

interface LinkedChild {
  link_id: string;
  student_id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  relationship: string;
  can_view_academic: boolean;
  enrollment_status: string;
  class_id?: string;
  class_name?: string;
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

interface ChildPeriodResult {
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

interface OfficialChildReportCard {
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

export const RealParentPortal: React.FC = () => {
  const { profile, school, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  const [loading, setLoading] = useState<boolean>(true);
  const [childrenList, setChildrenList] = useState<LinkedChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  // Calendar
  const [calendarPeriods, setCalendarPeriods] = useState<any[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');

  // Navigation Tabs (Academic vs Finance)
  const [parentViewTab, setParentViewTab] = useState<'academic' | 'finance'>('academic');

  // Academic Results & Official Report Card (Phase 2F.3C)
  const [loadingResults, setLoadingResults] = useState<boolean>(false);
  const [periodResult, setPeriodResult] = useState<ChildPeriodResult | null>(null);
  const [officialReportCard, setOfficialReportCard] = useState<OfficialChildReportCard | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);

  // Subject Assessments Detail Modal
  const [selectedSubjectDetail, setSelectedSubjectDetail] = useState<{
    subject: PeriodResultSubject;
    assessments: any[];
    loading: boolean;
  } | null>(null);

  // 1. Fetch Approved Linked Children
  const loadLinkedChildren = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('parent_student_links')
        .select(`
          id,
          relationship,
          can_view_academic,
          status,
          student_id,
          student:students (
            id,
            student_number,
            first_name,
            last_name,
            enrollment_status
          )
        `)
        .eq('parent_profile_id', profile.id)
        .eq('status', 'approved');

      if (error) throw error;

      const list: LinkedChild[] = (data || [])
        .filter((row: any) => row.student && row.can_view_academic)
        .map((row: any) => {
          let rel = row.relationship || 'Parent';
          if (rel.toLowerCase() === 'father') rel = 'Père';
          else if (rel.toLowerCase() === 'mother') rel = 'Mère';
          else if (rel.toLowerCase() === 'guardian') rel = 'Tuteur';

          return {
            link_id: row.id,
            student_id: row.student.id,
            student_number: row.student.student_number || '',
            first_name: row.student.first_name || '',
            last_name: row.student.last_name || '',
            relationship: rel,
            can_view_academic: !!row.can_view_academic,
            enrollment_status: row.student.enrollment_status
          };
        });

      setChildrenList(list);

      if (list.length > 0) {
        setSelectedChildId(prev => (prev && list.some(c => c.student_id === prev) ? prev : list[0].student_id));
      }
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du chargement de vos enfants rattachés.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, showToast]);

  useEffect(() => {
    loadLinkedChildren();
  }, [loadLinkedChildren]);

  // Selected Child object
  const activeChild = useMemo(() => {
    return childrenList.find(c => c.student_id === selectedChildId);
  }, [childrenList, selectedChildId]);

  // 2. Fetch School Calendar for Selected Child (Phase 2F.3C / 2F.1)
  const loadCalendarForChild = useCallback(async (childId: string) => {
    if (!childId) {
      setCalendarPeriods([]);
      setSelectedPeriodId('');
      setPeriodResult(null);
      setOfficialReportCard(null);
      return;
    }

    // Réinitialiser les états dépendants lors du changement d'enfant pour éviter l'affichage de données obsolètes
    setSelectedPeriodId('');
    setPeriodResult(null);
    setOfficialReportCard(null);

    try {
      // 2.1 Récupérer l'inscription active et le cycle de l'enfant
      const { data: enrollment, error: enrError } = await supabase
        .from('student_enrollments')
        .select(`
          id,
          school_id,
          academic_year_id,
          class_id,
          class:classes (
            id,
            name,
            education_cycle
          )
        `)
        .eq('student_id', childId)
        .eq('status', 'active')
        .maybeSingle();

      if (enrError) {
        console.error('[RealParentPortal] Erreur student_enrollments:', enrError, { childId });
        setCalendarPeriods([]);
        return;
      }

      if (!enrollment || !enrollment.class) {
        console.warn('[RealParentPortal] Aucune classe ou inscription active pour cet enfant.', { childId });
        setCalendarPeriods([]);
        return;
      }

      const cl = enrollment.class as any;
      const calParams = buildGetSchoolCalendarParams(
        enrollment.school_id,
        enrollment.academic_year_id,
        cl.education_cycle
      );

      if (!calParams) {
        console.error('[RealParentPortal] Paramètres calendrier invalides:', {
          school_id: enrollment.school_id,
          academic_year_id: enrollment.academic_year_id,
          cycle: cl.education_cycle
        });
        setCalendarPeriods([]);
        return;
      }

      // 2.2 Appel RPC sécurisé avec les 3 paramètres exacts
      const { data: calendarData, error: calError } = await supabase.rpc('get_school_calendar', calParams);
      if (calError) {
        console.error('[RealParentPortal] Erreur RPC get_school_calendar:', calError, { calParams });
        setCalendarPeriods([]);
        showToast('Impossible de charger le calendrier scolaire de cet enfant.', 'warning');
        return;
      }

      // 2.3 Extraction et tri stable des périodes
      const sortedPeriods = extractAndSortCalendarPeriods(calendarData);
      setCalendarPeriods(sortedPeriods);

      if (sortedPeriods.length > 0) {
        setSelectedPeriodId(sortedPeriods[0].id);
      }
    } catch (err: any) {
      console.error('[RealParentPortal] Erreur chargement calendrier:', err);
      setCalendarPeriods([]);
    }
  }, [showToast]);

  useEffect(() => {
    if (selectedChildId) {
      loadCalendarForChild(selectedChildId);
    } else {
      setCalendarPeriods([]);
      setSelectedPeriodId('');
      setPeriodResult(null);
      setOfficialReportCard(null);
    }
  }, [selectedChildId, loadCalendarForChild]);

  // 3. Fetch Official Period Result & Official Report Card (Phase 2F.3C)
  const loadChildPeriodResults = useCallback(async () => {
    if (!selectedChildId || !selectedPeriodId) {
      setPeriodResult(null);
      setOfficialReportCard(null);
      return;
    }

    setLoadingResults(true);
    try {
      // 3.1 Charger les résultats académiques périodiques
      const { data, error } = await supabase.rpc('get_student_period_result', {
        p_student_id: selectedChildId,
        p_period_id: selectedPeriodId
      });

      if (error) {
        console.error('[RealParentPortal] Erreur get_student_period_result:', error);
      }

      setPeriodResult(data ? (data as ChildPeriodResult) : null);

      // 3.2 Vérifier s'il existe un bulletin officiel publié via RLS pour cet enfant
      const { data: rcData, error: rcErr } = await supabase
        .from('period_report_cards')
        .select(`
          id, rank, overall_percentage, pdf_storage_path, pdf_version, pdf_generated_at, pdf_checksum,
          principal_remarks, homeroom_teacher_remarks,
          batch:report_card_batches!inner(status)
        `)
        .eq('student_id', selectedChildId)
        .eq('period_id', selectedPeriodId)
        .eq('batch.status', 'published')
        .maybeSingle();

      if (rcErr) {
        console.error('[RealParentPortal] Erreur chargement bulletin officiel:', rcErr);
        showToast("Erreur lors de la récupération du bulletin officiel de l'élève.", 'warning');
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
      console.error('[RealParentPortal] Erreur résultats / bulletin:', err);
      setPeriodResult(null);
      setOfficialReportCard(null);
    } finally {
      setLoadingResults(false);
    }
  }, [selectedChildId, selectedPeriodId]);

  useEffect(() => {
    loadChildPeriodResults();
  }, [loadChildPeriodResults]);

  // 4. Téléchargement Sécurisé du Bulletin PDF Officiel (Phase 2F.3C)
  const handleDownloadOfficialReportCard = async () => {
    if (!officialReportCard?.pdf_storage_path || isDownloadingPdf || !activeChild) return;

    setIsDownloadingPdf(true);
    try {
      const selectedPeriod = calendarPeriods.find(p => p.id === selectedPeriodId);
      const periodLabel = selectedPeriod?.name?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Periode';
      const cleanStudentName = `${activeChild.first_name}_${activeChild.last_name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Bulletin_${cleanStudentName}_${periodLabel}.pdf`;

      await downloadReportCardPdfBlob(officialReportCard.pdf_storage_path, filename);
      showToast(`Téléchargement du bulletin officiel de ${activeChild.first_name} lancé avec succès.`, 'success');
    } catch (err: any) {
      console.error('[RealParentPortal] Erreur téléchargement PDF:', err);
      showToast(err.message || 'Impossible de télécharger ce bulletin PDF.', 'warning');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // 5. Open Subject Assessments Details via RPC get_student_subject_period_result
  const handleOpenSubjectDetail = async (subject: PeriodResultSubject) => {
    if (!selectedChildId || !selectedPeriodId) return;

    setSelectedSubjectDetail({
      subject,
      assessments: [],
      loading: true
    });

    try {
      const { data, error } = await supabase.rpc('get_student_subject_period_result', {
        p_student_id: selectedChildId,
        p_subject_id: subject.subject_id,
        p_period_id: selectedPeriodId
      });

      if (error) throw error;

      setSelectedSubjectDetail({
        subject,
        assessments: data?.assessments || [],
        loading: false
      });
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la récupération du détail des notes.', 'warning');
      setSelectedSubjectDetail(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement de votre Espace Parent...</p>
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
                Espace Responsable Légal
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Parent : <strong className="text-white">{profile?.first_name} {profile?.last_name}</strong>
            </p>
          </div>
        </div>

        <button
          onClick={signOutReal}
          className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors cursor-pointer"
          title="Se déconnecter"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {childrenList.length === 0 ? (
          <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-4 shadow-xl">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
              <Users className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Aucun élève rattaché</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                Votre compte parent n'a actuellement aucun lien actif approuvé avec un dossier élève dans cet établissement.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Child and Period Selector Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-4">
              {/* Child Switcher */}
              <div className="w-full md:w-auto flex-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Enfant Sélectionné
                </label>
                <div className="flex flex-wrap gap-2">
                  {childrenList.map(c => (
                    <button
                      key={c.student_id}
                      type="button"
                      onClick={() => setSelectedChildId(c.student_id)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all cursor-pointer ${
                        selectedChildId === c.student_id
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>{c.first_name} {c.last_name}</span>
                      <span className="text-[10px] opacity-75 font-mono">({c.relationship})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Period Selector */}
              <div className="w-full md:w-72">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Période Scolaire
                </label>
                <select
                  value={selectedPeriodId}
                  onChange={e => setSelectedPeriodId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-bold"
                >
                  {calendarPeriods.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.parent_term_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Navigation Sub-Tabs (Academic vs Finance) */}
            <div className="flex border-b border-slate-800 pb-1 gap-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => setParentViewTab('academic')}
                className={`pb-2.5 transition border-b-2 flex items-center gap-2 cursor-pointer ${parentViewTab === 'academic' ? 'border-indigo-500 text-indigo-400 font-extrabold' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <Award className="w-4 h-4" />
                <span>Résultats Scolaires & Bulletins</span>
              </button>

              <button
                type="button"
                onClick={() => setParentViewTab('finance')}
                className={`pb-2.5 transition border-b-2 flex items-center gap-2 cursor-pointer ${parentViewTab === 'finance' ? 'border-amber-500 text-amber-400 font-extrabold' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <DollarSign className="w-4 h-4" />
                <span>Scolarité & Situation Financière</span>
              </button>
            </div>

            {/* FINANCE VIEW */}
            {parentViewTab === 'finance' && selectedChildId && (
              <ParentFinanceModule studentId={selectedChildId} />
            )}

            {/* ACADEMIC VIEW */}
            {parentViewTab === 'academic' && (
              <>
                {/* Official Report Card Download Banner (Phase 2F.3C) */}
            {officialReportCard && activeChild && (
              <div className="p-6 bg-gradient-to-r from-amber-500/20 via-slate-900 to-indigo-950/40 rounded-3xl border border-amber-500/40 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                    <FileCheck className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-amber-400 uppercase tracking-wider">
                        Bulletin Officiel Publié pour {activeChild.first_name}
                      </span>
                      <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-bold flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        Certifié Conforme
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">
                      {officialReportCard.rank ? (
                        <span>Rang officiel de l'élève : <strong className="text-white font-mono font-black">#{officialReportCard.rank}</strong> • </span>
                      ) : null}
                      Document officiel avec cachet de l'établissement et signatures de la direction.
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

            {/* Results Section */}
            {loadingResults ? (
              <div className="p-16 text-center text-slate-400 space-y-3">
                <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-bold">Récupération des résultats scolaires officiels...</p>
              </div>
            ) : !periodResult ? (
              <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
                <Award className="w-12 h-12 text-slate-600 mx-auto" />
                <h3 className="text-sm font-bold text-white">Résultats non publiés</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Le bulletin et les évaluations de cette période n'ont pas encore été clôturés ou publiés par l'établissement.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* General Percentage Summary Card */}
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
                        Pourcentage Général Périodique
                      </span>
                      <p className="text-3xl font-black text-amber-400">
                        {periodResult.overall_percentage !== null ? `${periodResult.overall_percentage} %` : 'En attente'}
                      </p>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        periodResult.is_complete
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {periodResult.is_complete ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Bulletin Complet
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3" />
                            Notes en attente
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Warning banner if incomplete */}
                  {!periodResult.is_complete && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                      <span>
                        {officialReportCard ? (
                          "Ce bulletin officiel a été publié avec des matières en attente. Toute correction ultérieure fera l’objet d’une nouvelle révision."
                        ) : (
                          "Certaines notes sont encore en cours de saisie par les enseignants. La moyenne générale sera mise à jour dès la publication complète des évaluations."
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
                      Matières & Moyennes Périodiques ({periodResult.subjects.length})
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-bold border-b border-slate-800">
                        <tr>
                          <th className="px-6 py-4">Matière</th>
                          <th className="px-6 py-4 text-center">Coefficient</th>
                          <th className="px-6 py-4 text-center">Évaluations</th>
                          <th className="px-6 py-4 text-center">Moyenne Matière</th>
                          <th className="px-6 py-4 text-center">État</th>
                          <th className="px-6 py-4 text-right">Détail des Notes</th>
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
                                Consulter
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
      </div>
    )}
  </main>

      {/* Subject Assessments Detail Modal */}
      {selectedSubjectDetail && (
        <Modal
          isOpen={!!selectedSubjectDetail}
          onClose={() => setSelectedSubjectDetail(null)}
          title={`Détail des Évaluations : ${selectedSubjectDetail.subject.subject_name}`}
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
                    Aucune évaluation enregistrée pour cette matière.
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
        ÉcoleConnect — Espace Numérique Responsable Légal
      </footer>
    </div>
  );
};
