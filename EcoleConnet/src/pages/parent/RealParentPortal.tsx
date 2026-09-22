// Fichier : src/pages/parent/RealParentPortal.tsx
// Portail Parent Réel : Design Moderne & Professionnel (Lot 1 Migration Visual Modernization)
// Consultation officielle des résultats, bulletins PDF (Phase 2F.3C) et finance Supabase réelle.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { supabase } from '../../lib/supabase';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { StatCard } from '../../components/common/StatCard';
import {
  Users,
  Award,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Clock,
  Eye,
  Download,
  FileCheck,
  ShieldCheck,
  MessageSquare,
  Calendar,
  FileText,
  ChevronRight,
  GraduationCap
} from 'lucide-react';

import { downloadReportCardPdfBlob, isPublishedPdfMetadataComplete } from '../../services/reportCardPdfService';
import { buildGetSchoolCalendarParams, extractAndSortCalendarPeriods } from '../../services/calendarService';
import { ParentFinanceModule } from '../../components/parent/ParentFinanceModule';
import { ParentAttendanceModule } from '../../components/parent/ParentAttendanceModule';
import { ParentHomeworkModule } from '../../components/parent/ParentHomeworkModule';
import { ParentTimetableModule } from '../../components/parent/ParentTimetableModule';

// Sub-components pour le design modernisé
import { ParentPortalSidebar } from '../../components/parent/portal/ParentPortalSidebar';
import { ParentPortalHeader } from '../../components/parent/portal/ParentPortalHeader';
import { ParentChildSwitcher, type LinkedChild } from '../../components/parent/portal/ParentChildSwitcher';
import { ParentModulePlaceholder } from '../../components/parent/portal/ParentModulePlaceholder';

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

  // Navigation State
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isOpenMobile, setIsOpenMobile] = useState<boolean>(false);

  // Parent Links & Children State
  const [loading, setLoading] = useState<boolean>(true);
  const [childrenList, setChildrenList] = useState<LinkedChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  // Calendar State
  const [calendarPeriods, setCalendarPeriods] = useState<any[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');

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

  // 1. Fetch Approved Linked Children (Real Supabase RLS)
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

      // Récupérer la classe active pour chaque élève rattaché
      const studentIds = (data || []).filter((row: any) => row.student).map((row: any) => row.student.id);
      let enrollmentsMap: Record<string, { class_id: string; class_name: string }> = {};

      if (studentIds.length > 0) {
        const { data: enrData, error: enrError } = await supabase
          .from('student_enrollments')
          .select(`
            student_id,
            class_id,
            class:classes (
              id,
              name
            )
          `)
          .in('student_id', studentIds)
          .eq('status', 'active');

        if (!enrError && enrData) {
          enrData.forEach((enr: any) => {
            if (enr.class) {
              enrollmentsMap[enr.student_id] = {
                class_id: enr.class.id,
                class_name: enr.class.name
              };
            }
          });
        }
      }

      const list: LinkedChild[] = (data || [])
        .filter((row: any) => row.student && row.can_view_academic)
        .map((row: any) => {
          let rel = row.relationship || 'Parent';
          if (rel.toLowerCase() === 'father') rel = 'Père';
          else if (rel.toLowerCase() === 'mother') rel = 'Mère';
          else if (rel.toLowerCase() === 'guardian') rel = 'Tuteur';

          const enrInfo = enrollmentsMap[row.student.id];

          return {
            link_id: row.id,
            student_id: row.student.id,
            student_number: row.student.student_number || '',
            first_name: row.student.first_name || '',
            last_name: row.student.last_name || '',
            relationship: rel,
            can_view_academic: !!row.can_view_academic,
            enrollment_status: row.student.enrollment_status,
            class_id: enrInfo?.class_id,
            class_name: enrInfo?.class_name
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

  // 2. Fetch School Calendar for Selected Child
  const loadCalendarForChild = useCallback(async (childId: string) => {
    if (!childId) {
      setCalendarPeriods([]);
      setSelectedPeriodId('');
      setPeriodResult(null);
      setOfficialReportCard(null);
      return;
    }

    setSelectedPeriodId('');
    setPeriodResult(null);
    setOfficialReportCard(null);

    try {
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
        setCalendarPeriods([]);
        return;
      }

      const { data: calendarData, error: calError } = await supabase.rpc('get_school_calendar', calParams);
      if (calError) {
        console.error('[RealParentPortal] Erreur RPC get_school_calendar:', calError, { calParams });
        setCalendarPeriods([]);
        showToast('Impossible de charger le calendrier scolaire de cet enfant.', 'warning');
        return;
      }

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
      const { data, error } = await supabase.rpc('get_student_period_result', {
        p_student_id: selectedChildId,
        p_period_id: selectedPeriodId
      });

      if (error) {
        console.error('[RealParentPortal] Erreur get_student_period_result:', error);
      }

      setPeriodResult(data ? (data as ChildPeriodResult) : null);

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
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement sécurisé de votre Espace Parent...</p>
      </div>
    );
  }

  const parentFullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Parent d\'élève';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row font-sans selection:bg-blue-600 selection:text-white">
      {/* Sidebar Navigation */}
      <ParentPortalSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpenMobile={isOpenMobile}
        onCloseMobile={() => setIsOpenMobile(false)}
        parentName={parentFullName}
        schoolName={school?.name}
        onSignOut={signOutReal}
      />

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen bg-slate-50">
        {/* Top Header */}
        <ParentPortalHeader
          schoolName={school?.name}
          parentName={parentFullName}
          onOpenMobileMenu={() => setIsOpenMobile(true)}
          onSignOut={signOutReal}
        />

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-8">
          {childrenList.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-4 shadow-xs my-8">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mx-auto">
                <Users className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-extrabold text-slate-900">Aucun élève rattaché</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Votre compte parent n'a actuellement aucun lien actif approuvé avec un dossier élève dans cet établissement.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Child Switcher Banner */}
              <ParentChildSwitcher
                childrenList={childrenList}
                selectedChildId={selectedChildId}
                onSelectChild={setSelectedChildId}
                activeChild={activeChild}
                overallPercentage={periodResult?.overall_percentage}
              />

              {/* TAB 1: TABLEAU DE BORD (DASHBOARD OVERVIEW) */}
              {activeTab === 'dashboard' && (
                <div className="space-y-8 animate-fade-in">
                  {/* KPI Stat Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                      title="Moyenne Générale"
                      value={periodResult?.overall_percentage !== null && periodResult?.overall_percentage !== undefined ? `${periodResult.overall_percentage}%` : 'En attente'}
                      subtitle={periodResult?.period_name ? `Période: ${periodResult.period_name}` : 'Période en cours'}
                      icon={<Award className="w-5 h-5" />}
                      colorScheme="amber"
                    />

                    <StatCard
                      title="Enfants Rattachés"
                      value={childrenList.length}
                      subtitle="Dossiers scolaires actifs"
                      icon={<Users className="w-5 h-5" />}
                      colorScheme="blue"
                    />

                    <StatCard
                      title="Bulletin Officiel"
                      value={officialReportCard ? 'Disponible' : 'En attente'}
                      subtitle={officialReportCard?.rank ? `Rang: #${officialReportCard.rank}` : 'Clôture de période'}
                      icon={<FileCheck className="w-5 h-5" />}
                      colorScheme={officialReportCard ? 'emerald' : 'purple'}
                    />

                    <StatCard
                      title="Sécurité Compte"
                      value="Approuvé"
                      subtitle="Isolation Supabase RLS"
                      icon={<ShieldCheck className="w-5 h-5" />}
                      colorScheme="emerald"
                    />
                  </div>

                  {/* Children Overview Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                        <GraduationCap className="w-5 h-5 text-blue-600" />
                        Aperçu des Enfants ({childrenList.length})
                      </h3>
                      <button
                        type="button"
                        onClick={() => setActiveTab('mes_enfants')}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                      >
                        <span>Voir détails</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      {childrenList.map((ch) => {
                        const isSelected = ch.student_id === selectedChildId;
                        const childInitials = `${ch.first_name.charAt(0)}${ch.last_name.charAt(0)}`.toUpperCase();
                        return (
                          <div
                            key={ch.student_id}
                            className={`bg-white rounded-3xl p-6 border shadow-xs transition-all flex flex-col justify-between ${
                              isSelected ? 'border-amber-400 ring-2 ring-amber-400/20' : 'border-slate-200'
                            }`}
                          >
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-black text-base flex items-center justify-center border border-amber-300">
                                    {childInitials}
                                  </div>
                                  <div>
                                    <h4 className="font-extrabold text-base text-slate-900">
                                      {ch.first_name} {ch.last_name}
                                    </h4>
                                    <p className="text-xs text-slate-500 font-medium">
                                      {ch.class_name || 'Non affecté'} • <span className="font-mono">{ch.student_number}</span>
                                    </p>
                                  </div>
                                </div>
                                {isSelected && (
                                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                                    Sélectionné
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-3 gap-3 text-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                <div>
                                  <p className="text-[10px] text-slate-400 font-extrabold uppercase">Moyenne</p>
                                  <p className="text-sm font-extrabold text-blue-700">
                                    {isSelected && periodResult?.overall_percentage !== null && periodResult?.overall_percentage !== undefined
                                      ? `${periodResult.overall_percentage}%`
                                      : 'En attente'}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-slate-400 font-extrabold uppercase">Lien</p>
                                  <p className="text-sm font-extrabold text-emerald-600">{ch.relationship}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-slate-400 font-extrabold uppercase">Statut</p>
                                  <p className="text-sm font-extrabold text-amber-600">Actif</p>
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedChildId(ch.student_id);
                                setActiveTab('resultats');
                              }}
                              className={`mt-4 w-full py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                                isSelected
                                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                              }`}
                            >
                              <Award className="w-4 h-4 text-amber-400" />
                              <span>Consulter bulletins & résultats de {ch.first_name}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Official Report Card Download Banner (Phase 2F.3C) */}
                  {officialReportCard && activeChild && (
                    <div className="p-6 bg-gradient-to-r from-amber-500/20 via-slate-900 to-indigo-950 rounded-3xl border border-amber-500/40 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-white">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                          <FileCheck className="w-6 h-6" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
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
                            Document officiel certifié par la direction de l'établissement.
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
                </div>
              )}

              {/* TAB 2: MES ENFANTS */}
              {activeTab === 'mes_enfants' && (
                <div className="space-y-6 animate-fade-in">
                  <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-6">
                    <div>
                      <h2 className="text-xl font-extrabold text-slate-900">Dossiers de mes enfants rattachés</h2>
                      <p className="text-xs text-slate-500 mt-1">
                        Consultez la liste des élèves officiellement associés à votre compte responsable légal.
                      </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      {childrenList.map((ch) => {
                        const isSelected = ch.student_id === selectedChildId;
                        const childInitials = `${ch.first_name.charAt(0)}${ch.last_name.charAt(0)}`.toUpperCase();
                        return (
                          <div
                            key={ch.student_id}
                            className={`p-6 rounded-3xl border transition-all space-y-4 ${
                              isSelected
                                ? 'bg-slate-900 text-white border-amber-400 ring-2 ring-amber-400/20'
                                : 'bg-slate-50 text-slate-900 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-14 h-14 rounded-2xl bg-amber-500 text-slate-950 font-black text-lg flex items-center justify-center border-2 border-amber-300 shrink-0">
                                {childInitials}
                              </div>
                              <div>
                                <h3 className="text-lg font-extrabold">{ch.first_name} {ch.last_name}</h3>
                                <p className={`text-xs ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                                  Matricule : <span className="font-mono font-bold text-amber-400">{ch.student_number}</span>
                                </p>
                              </div>
                            </div>

                            <div className="space-y-2 text-xs divide-y divide-slate-200/40">
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-400">Classe actuelle</span>
                                <strong className="font-bold">{ch.class_name || 'Non affecté'}</strong>
                              </div>
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-400">Lien de parenté</span>
                                <strong className="font-bold">{ch.relationship}</strong>
                              </div>
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-400">Accès académique</span>
                                <span className="text-emerald-400 font-bold">Autorisé</span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setSelectedChildId(ch.student_id)}
                              className={`w-full py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-amber-500 text-slate-950'
                                  : 'bg-slate-200 hover:bg-slate-300 text-slate-900'
                              }`}
                            >
                              {isSelected ? 'Enfant actuellement sélectionné' : `Sélectionner ${ch.first_name}`}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: RÉSULTATS ET BULLETINS (PHASE 2F.3C) */}
              {activeTab === 'resultats' && (
                <div className="space-y-6 animate-fade-in">
                  {/* Period Selector Header */}
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-extrabold text-slate-900">Bulletins & Résultats Scolaires</h2>
                      <p className="text-xs text-slate-500 mt-1">
                        Évaluations périodiques et bulletin certifié conforme de {activeChild?.first_name}.
                      </p>
                    </div>

                    <div className="w-full md:w-72">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Sélectionner la Période
                      </label>
                      <select
                        value={selectedPeriodId}
                        onChange={e => setSelectedPeriodId(e.target.value)}
                        className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-blue-500 font-bold"
                      >
                        {calendarPeriods.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.parent_term_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Official Report Card Download Banner (Phase 2F.3C) */}
                  {officialReportCard && activeChild && (
                    <div className="p-6 bg-gradient-to-r from-amber-500/20 via-slate-900 to-indigo-950 text-white rounded-3xl border border-amber-500/40 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                          <FileCheck className="w-6 h-6" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
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

                  {/* Period Results Section */}
                  {loadingResults ? (
                    <div className="p-16 text-center text-slate-500 space-y-3 bg-white rounded-3xl border border-slate-200">
                      <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                      <p className="text-xs font-bold">Récupération des résultats scolaires officiels...</p>
                    </div>
                  ) : !periodResult ? (
                    <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-3">
                      <Award className="w-12 h-12 text-slate-400 mx-auto" />
                      <h3 className="text-sm font-bold text-slate-900">Résultats non publiés</h3>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        Le bulletin et les évaluations de cette période n'ont pas encore été clôturés ou publiés par l'établissement.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Summary Banner */}
                      <div className="p-6 bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-xl space-y-4">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                                {periodResult.student_number}
                              </span>
                              <h3 className="text-xl font-black text-white">{periodResult.student_name}</h3>
                            </div>
                            <p className="text-xs text-slate-400">
                              Classe : <strong className="text-slate-200">{periodResult.class_name}</strong> • {periodResult.period_name} ({periodResult.term_name})
                            </p>
                          </div>

                          <div className="bg-slate-950 px-6 py-4 rounded-2xl border border-slate-800 text-right space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                              Moyenne Générale Périodique
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

                        {!periodResult.is_complete && (
                          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                            <span>
                              {officialReportCard ? (
                                "Ce bulletin officiel a été publié avec des matières en attente."
                              ) : (
                                "Certaines notes sont encore en cours de saisie par les enseignants."
                              )}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Subjects Table */}
                      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-blue-600" />
                            Matières & Moyennes Périodiques ({periodResult.subjects.length})
                          </h3>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider font-extrabold border-b border-slate-200">
                              <tr>
                                <th className="px-6 py-4">Matière</th>
                                <th className="px-6 py-4 text-center">Coefficient</th>
                                <th className="px-6 py-4 text-center">Évaluations</th>
                                <th className="px-6 py-4 text-center">Moyenne Matière</th>
                                <th className="px-6 py-4 text-center">État</th>
                                <th className="px-6 py-4 text-right">Détail des Notes</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {periodResult.subjects.map(sbj => (
                                <tr key={sbj.subject_id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-6 py-4 font-extrabold text-slate-900 flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 font-bold text-xs">
                                      {sbj.subject_name.charAt(0).toUpperCase()}
                                    </div>
                                    <span>{sbj.subject_name}</span>
                                  </td>
                                  <td className="px-6 py-4 text-center font-bold text-amber-600">
                                    {sbj.subject_coefficient}
                                  </td>
                                  <td className="px-6 py-4 text-center text-slate-600">
                                    {sbj.completed_assessment_count} / {sbj.assessment_count}
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    {sbj.subject_percentage !== null ? (
                                      <span
                                        className={`inline-flex items-center px-3 py-1 rounded-xl font-black text-sm ${
                                          sbj.subject_percentage >= 70
                                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                            : sbj.subject_percentage >= 50
                                            ? 'bg-amber-50 border border-amber-200 text-amber-700'
                                            : 'bg-rose-50 border border-rose-200 text-rose-700'
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
                                      <span className="text-emerald-600 font-bold text-[11px]">Complet</span>
                                    ) : (
                                      <span className="text-amber-600 font-bold text-[11px]">En cours</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenSubjectDetail(sbj)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-amber-400" />
                                      <span>Consulter</span>
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
                </div>
              )}

              {/* TAB 7: PAIEMENTS ET FINANCE */}
              {activeTab === 'paiements' && selectedChildId && (
                <div className="animate-fade-in">
                  <ParentFinanceModule studentId={selectedChildId} />
                </div>
              )}

              {/* PLACEHOLDER TABS FOR FUTURE RPC INTEGRATION */}
              {/* TAB 3: PRÉSENCES & ASSIDUITÉ RÉELLES */}
              {activeTab === 'presences' && selectedChildId && (
                <div className="animate-fade-in">
                  <ParentAttendanceModule studentId={selectedChildId} />
                </div>
              )}

              {/* TAB 5: DEVOIRS & CAHIER DE TEXTE RÉELS */}
              {activeTab === 'devoirs' && selectedChildId && (
                <div className="animate-fade-in">
                  <ParentHomeworkModule studentId={selectedChildId} />
                </div>
              )}

              {/* TAB 6: EMPLOI DU TEMPS RÉEL */}
              {activeTab === 'emploi_du_temps' && selectedChildId && (
                <div className="animate-fade-in">
                  <ParentTimetableModule studentId={selectedChildId} />
                </div>
              )}

              {activeTab === 'messages' && (
                <ParentModulePlaceholder
                  title="Messagerie & Communications Officieuses"
                  description="Échangez des messages sécurisés avec la direction et les enseignants de votre enfant directement depuis votre portail."
                  icon={MessageSquare}
                  childName={activeChild?.first_name}
                />
              )}

              {activeTab === 'calendrier' && (
                <ParentModulePlaceholder
                  title="Calendrier Scolaire & Événements"
                  description="Accédez aux événements marquants de l'établissement, réunions de parents, examens et congés scolaires officiels."
                  icon={Calendar}
                  childName={activeChild?.first_name}
                />
              )}

              {activeTab === 'documents' && (
                <ParentModulePlaceholder
                  title="Documents & Attestations Admin"
                  description="Téléchargez et conservez les attestations de fréquentation, fiches médicales et règlements administratifs de l'établissement."
                  icon={FileText}
                  childName={activeChild?.first_name}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Subject Assessments Detail Modal */}
      {selectedSubjectDetail && (
        <Modal
          isOpen={!!selectedSubjectDetail}
          onClose={() => setSelectedSubjectDetail(null)}
          title={`Détail des Évaluations : ${selectedSubjectDetail.subject.subject_name}`}
        >
          {selectedSubjectDetail.loading ? (
            <div className="p-12 text-center text-slate-500 space-y-3">
              <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs font-bold">Chargement des évaluations...</p>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 flex justify-between items-center">
                <div>
                  <p className="text-slate-400">Matière : <strong className="text-blue-400">{selectedSubjectDetail.subject.subject_name}</strong></p>
                  <p className="text-slate-400 mt-0.5">Coefficient : <strong className="text-amber-400">{selectedSubjectDetail.subject.subject_coefficient}</strong></p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Moyenne Matière</span>
                  <span className="text-xl font-black text-amber-400">
                    {selectedSubjectDetail.subject.subject_percentage !== null ? `${selectedSubjectDetail.subject.subject_percentage} %` : 'En attente'}
                  </span>
                </div>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {selectedSubjectDetail.assessments.length === 0 ? (
                  <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                    Aucune évaluation enregistrée pour cette matière.
                  </div>
                ) : (
                  selectedSubjectDetail.assessments.map((asmt: any, idx: number) => (
                    <div key={asmt.assessment_id || idx} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-extrabold text-slate-900 text-xs">{asmt.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Date : {asmt.assessment_date} • Coeff évaluation : {asmt.coefficient}
                          </p>
                        </div>

                        <div className="text-right">
                          {asmt.is_absent ? (
                            asmt.is_excused ? (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 block">
                                Absence Excusée
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 block">
                                Absence non justifiée (0 %)
                              </span>
                            )
                          ) : asmt.score !== null && asmt.score !== undefined ? (
                            <div>
                              <span className="text-base font-black text-slate-900">
                                {asmt.score} <span className="text-xs text-slate-500">/ {asmt.max_score}</span>
                              </span>
                              <span className="text-xs font-bold text-amber-600 block">
                                ({asmt.normalized_percentage} %)
                              </span>
                            </div>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 block">
                              En attente
                            </span>
                          )}
                        </div>
                      </div>

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
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl cursor-pointer"
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
