// Portail Enseignant Réel ÉcoleConnect
// Fichier : src/pages/teacher/RealTeacherPortal.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { 
  BookOpen, Clock, LogOut, Plus, AlertCircle, FileText, CheckCircle2, Filter, Edit3, XCircle, Send
} from 'lucide-react';
import { TeacherGradesModule } from '../../components/teacher/TeacherGradesModule';
import { TeacherOfficialSignatureCard } from '../../components/teacher/TeacherOfficialSignatureCard';
import { TeacherClassFinanceOverview } from '../../components/teacher/TeacherClassFinanceOverview';

export type TeacherTab = 
  | 'overview' 
  | 'classes' 
  | 'presences' 
  | 'schedule' 
  | 'homework' 
  | 'grades' 
  | 'finance'
  | 'messages' 
  | 'profile';

interface TeacherAssignment {
  id: string;
  class_id: string;
  subject_id: string | null;
  academic_year_id: string;
  is_active: boolean;
  class_name?: string;
  subject_name?: string;
  student_count?: number;
}

interface HomeworkRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  term_id: string | null;
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string;
  teacher_name: string;
  title: string;
  instructions: string;
  assigned_on: string;
  due_at: string;
  estimated_minutes: number | null;
  status: 'draft' | 'published' | 'closed' | 'cancelled';
  published_at: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface TeacherSessionRow {
  id: string;
  school_id: string;
  class_id: string;
  academic_year_id: string;
  subject_id: string | null;
  teacher_id: string | null;
  attendance_date: string;
  started_at: string;
  completed_at: string | null;
  status: 'draft' | 'completed' | 'reopened' | 'cancelled';
  notes: string | null;
  class_name?: string;
  subject_name?: string;
}

export const RealTeacherPortal: React.FC = () => {
  const { user, profile, school, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  const [activeTab, setActiveTab] = useState<TeacherTab>('overview');
  const [selectedFinanceClassId, setSelectedFinanceClassId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  // Teacher Profile Record
  const [teacherRecord, setTeacherRecord] = useState<any>(null);

  // Real Data States
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [groupedAssignments, setGroupedAssignments] = useState<Array<{
    id: string;
    class_id: string;
    class_name: string;
    is_homeroom?: boolean;
    subject_id: string | null;
    subjects: string[];
    subject_name: string;
  }>>([]);
  const [totalUniqueStudentsCount, setTotalUniqueStudentsCount] = useState<number>(0);
  const [classesList, setClassesList] = useState<any[]>([]);
  const [subjectsList, setSubjectsList] = useState<any[]>([]);
  const [schoolTermsList, setSchoolTermsList] = useState<any[]>([]);
  const [schoolPeriodsList, setSchoolPeriodsList] = useState<any[]>([]);
  const [teacherSessions, setTeacherSessions] = useState<TeacherSessionRow[]>([]);
  const [gradesCount, setGradesCount] = useState<number>(0);
  const [classStudentsMap, setClassStudentsMap] = useState<Record<string, any[]>>({});

  // Form / Modal States for Presences
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [showTakeAttendanceModal, setShowTakeAttendanceModal] = useState(false);
  const [showClassStudentsModal, setShowClassStudentsModal] = useState(false);
  const [selectedClassForRoster, setSelectedClassForRoster] = useState<any>(null);
  const [selectedSession, setSelectedSession] = useState<TeacherSessionRow | null>(null);

  // New Session Form
  const [newSessionClassId, setNewSessionClassId] = useState('');
  const [newSessionSubjectId, setNewSessionSubjectId] = useState('');
  const [newSessionDate, setNewSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [creatingSession, setCreatingSession] = useState(false);

  // Attendance Sheet Temp State
  const [sheetRecords, setSheetRecords] = useState<Array<{
    student: any;
    enrollment_id: string;
    status: 'present' | 'absent' | 'late' | 'excused' | 'left_early';
    arrival_time: string;
    justification: string;
  }>>([]);
  const [savingAttendance, setSavingAttendance] = useState(false);

  // Teacher Phone Profile Edit
  const [teacherPhone, setTeacherPhone] = useState('');
  const [updatingPhone, setUpdatingPhone] = useState(false);

  // Homework States
  const [homeworkList, setHomeworkList] = useState<HomeworkRow[]>([]);
  const [hwClassFilter, setHwClassFilter] = useState<string>('all');
  const [hwSubjectFilter, setHwSubjectFilter] = useState<string>('all');
  const [hwStatusFilter, setHwStatusFilter] = useState<string>('all');

  // Homework Modals
  const [showCreateHwModal, setShowCreateHwModal] = useState<boolean>(false);
  const [showDetailHwModal, setShowDetailHwModal] = useState<boolean>(false);
  const [showEditHwModal, setShowEditHwModal] = useState<boolean>(false);
  const [showCancelHwModal, setShowCancelHwModal] = useState<boolean>(false);
  const [selectedHw, setSelectedHw] = useState<HomeworkRow | null>(null);

  // Homework Form Fields
  const [hwClassId, setHwClassId] = useState<string>('');
  const [hwSubjectId, setHwSubjectId] = useState<string>('');
  const [hwTitle, setHwTitle] = useState<string>('');
  const [hwInstructions, setHwInstructions] = useState<string>('');
  const [hwAssignedOn, setHwAssignedOn] = useState<string>(new Date().toISOString().split('T')[0]);
  const [homeworkDueDate, setHomeworkDueDate] = useState<string>('');
  const [homeworkDueTime, setHomeworkDueTime] = useState<string>('');
  const [hwEstimatedMinutes, setHwEstimatedMinutes] = useState<string>('');
  const [hwPublishNow, setHwPublishNow] = useState<boolean>(false);
  const [submittingHw, setSubmittingHw] = useState<boolean>(false);

  // Reason field for edit published / cancel
  const [actionReason, setActionReason] = useState<string>('');
  const [submittingAction, setSubmittingAction] = useState<boolean>(false);

  // Load Real Data for Logged-in Teacher
  const loadTeacherPortalData = useCallback(async () => {
    if (!profile?.id || !school?.id) return;
    setLoading(true);
    setAccessError(null);

    try {
      // 1. Charger et vérifier le dossier enseignant (Point 4)
      const { data: tchData, error: tchErr } = await supabase
        .from('teachers')
        .select('*')
        .eq('profile_id', profile.id)
        .single();

      if (tchErr || !tchData) {
        setAccessError("Aucun dossier enseignant n'est associé à votre compte utilisateur.");
        return;
      }

      if (tchData.account_status !== 'active') {
        setAccessError(`Votre compte enseignant n'est pas actif (statut actuel: "${tchData.account_status}"). Veuillez contacter l'administration.`);
        return;
      }

      if (tchData.employment_status !== 'active') {
        setAccessError(`Votre contrat d'enseignant n'est pas actif (statut actuel: "${tchData.employment_status}"). Veuillez contacter l'administration.`);
        return;
      }

      setTeacherRecord(tchData);
      setTeacherPhone(tchData.phone || '');

      // 2. Charger les affectations actives
      const { data: assignData } = await supabase
        .from('teacher_class_assignments')
        .select('*')
        .eq('school_id', school.id)
        .eq('is_active', true);

      // 3. Charger les classes et matières
      const { data: clsData } = await supabase
        .from('classes')
        .select('*')
        .eq('school_id', school.id);

      const { data: sbjData } = await supabase
        .from('subjects')
        .select('*')
        .eq('school_id', school.id);

      const { data: termsData } = await supabase
        .from('school_terms')
        .select('*')
        .eq('school_id', school.id)
        .order('position', { ascending: true });

      const { data: periodsData } = await supabase
        .from('school_periods')
        .select('*')
        .eq('school_id', school.id)
        .order('position', { ascending: true });

      setClassesList(clsData || []);
      setSubjectsList(sbjData || []);
      setSchoolTermsList(termsData || []);
      setSchoolPeriodsList(periodsData || []);

      // 4. Filtrer les affectations actives de cet enseignant et identifier les classes dont il est titulaire
      const myHomeroomClasses = (clsData || []).filter(
        c => c.is_active !== false && c.homeroom_teacher_id === profile.id
      );

      const synthesizedHomeroomAssignments: TeacherAssignment[] = myHomeroomClasses.map(c => ({
        id: `homeroom-${c.id}`,
        class_id: c.id,
        subject_id: null,
        academic_year_id: c.academic_year_id || '',
        is_active: true,
        class_name: c.name || 'Classe inconnue',
        subject_name: 'Titularisation (Appel Général)'
      }));

      const mySubjectAssignments = (assignData || [])
        .filter(a => tchData && a.teacher_id === tchData.id)
        .map(a => {
          const cls = clsData?.find(c => c.id === a.class_id);
          const sbj = sbjData?.find(s => s.id === a.subject_id);
          return {
            ...a,
            class_name: cls?.name || 'Classe inconnue',
            subject_name: sbj ? `${sbj.name}${sbj.code ? ` (${sbj.code})` : ''}` : 'Appel Général'
          };
        });

      setAssignments([...synthesizedHomeroomAssignments, ...mySubjectAssignments]);

      // 5. Regrouper les affectations (titularisation + matières) par classe unique sans doublon
      const classGroupMap = new Map<string, {
        id: string;
        class_id: string;
        class_name: string;
        is_homeroom: boolean;
        subject_id: string | null;
        subjects: string[];
        subject_name: string;
      }>();

      // Enregistrer d'abord les classes dont l'enseignant est titulaire
      myHomeroomClasses.forEach(c => {
        classGroupMap.set(c.id, {
          id: `homeroom-${c.id}`,
          class_id: c.id,
          class_name: c.name || 'Classe inconnue',
          is_homeroom: true,
          subject_id: null,
          subjects: [],
          subject_name: 'Titularisation (Appel Général)'
        });
      });

      // Fusionner avec les affectations par matière
      mySubjectAssignments.forEach(a => {
        if (!classGroupMap.has(a.class_id)) {
          classGroupMap.set(a.class_id, {
            id: a.id,
            class_id: a.class_id,
            class_name: a.class_name,
            is_homeroom: false,
            subject_id: a.subject_id || null,
            subjects: a.subject_name ? [a.subject_name] : [],
            subject_name: a.subject_name || 'Appel Général'
          });
        } else {
          const existing = classGroupMap.get(a.class_id)!;
          if (a.subject_name && a.subject_name !== 'Appel Général' && a.subject_name !== 'Titularisation (Appel Général)') {
            if (!existing.subjects.includes(a.subject_name)) {
              existing.subjects.push(a.subject_name);
            }
            existing.subject_name = existing.subjects.join(', ');
          }
        }
      });

      const grouped = Array.from(classGroupMap.values());
      setGroupedAssignments(grouped);

      // 6. Extraire les class_id des classes réellement attribuées et affichées (Point 1)
      const activeAssignedClassIds = new Set(grouped.map(g => g.class_id));

      // 7. Charger les élèves de ses classes via la RPC sécurisée get_teacher_assigned_students()
      const { data: assignedStudents } = await supabase.rpc('get_teacher_assigned_students');

      // 8. Filtrer exclusivement les élèves dont la classe appartient aux classes réellement affichées (Point 1)
      const studentsInDisplayedClasses = (assignedStudents || []).filter((st: any) =>
        activeAssignedClassIds.has(st.class_id)
      );

      const map: Record<string, any[]> = {};
      studentsInDisplayedClasses.forEach((st: any) => {
        if (!map[st.class_id]) map[st.class_id] = [];
        if (!map[st.class_id].some(item => item.id === st.student_id)) {
          map[st.class_id].push({
            id: st.student_id,
            student_number: st.student_number,
            first_name: st.first_name,
            last_name: st.last_name,
            class_id: st.class_id,
            class_name: st.class_name
          });
        }
      });

      setClassStudentsMap(map);

      // 9. Dédupliquer le nombre total d'élèves uniques appartenant aux classes affichées (Point 1)
      const uniqueDisplayedStudentIds = new Set(
        studentsInDisplayedClasses.map((st: any) => st.student_id)
      );
      setTotalUniqueStudentsCount(uniqueDisplayedStudentIds.size);

      // 10. Charger les séances d'appel créées par ou pour cet enseignant
      const { data: sessData } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('school_id', school.id)
        .order('attendance_date', { ascending: false });

      const mappedSessions = (sessData || []).map(s => {
        const cls = clsData?.find(c => c.id === s.class_id);
        const sbj = sbjData?.find(sub => sub.id === s.subject_id);
        return {
          ...s,
          class_name: cls?.name || 'Classe inconnue',
          subject_name: sbj ? sbj.name : 'Appel Général'
        };
      });

      setTeacherSessions(mappedSessions);

      // 11. Charger les devoirs réels via la RPC get_teacher_homework()
      const { data: hwData } = await supabase.rpc('get_teacher_homework');
      setHomeworkList((hwData || []) as HomeworkRow[]);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du chargement de vos données d’enseignant.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [profile?.id, school?.id, showToast]);

  useEffect(() => {
    loadTeacherPortalData();
  }, [loadTeacherPortalData]);

  // Handlers - Attendance Creation
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionClassId || !newSessionDate) {
      showToast('La classe et la date sont obligatoires.', 'warning');
      return;
    }

    setCreatingSession(true);
    try {
      const { data: sessionId, error } = await supabase.rpc('create_attendance_session', {
        p_class_id: newSessionClassId,
        p_subject_id: newSessionSubjectId || null,
        p_attendance_date: newSessionDate
      });

      if (error) throw error;

      showToast('Séance de présence créée avec succès !', 'success');
      setShowNewSessionModal(false);
      await loadTeacherPortalData();

      // Ouvrir immédiatement la feuille d'appel
      const targetClass = classesList.find(c => c.id === newSessionClassId);
      const targetSubject = subjectsList.find(s => s.id === newSessionSubjectId);
      
      const newSessRow: TeacherSessionRow = {
        id: sessionId,
        school_id: school?.id || '',
        class_id: newSessionClassId,
        academic_year_id: targetClass?.academic_year_id || '',
        subject_id: newSessionSubjectId || null,
        teacher_id: teacherRecord?.id || null,
        attendance_date: newSessionDate,
        started_at: new Date().toISOString(),
        completed_at: null,
        status: 'draft',
        notes: null,
        class_name: targetClass?.name || '',
        subject_name: targetSubject?.name || 'Appel Général'
      };

      openAttendanceSheet(newSessRow);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de l’appel.', 'warning');
    } finally {
      setCreatingSession(false);
    }
  };

  const openAttendanceSheet = async (session: TeacherSessionRow) => {
    setSelectedSession(session);

    const classStudents = classStudentsMap[session.class_id] || [];

    // Récupérer les présences déjà enregistrées
    const { data: existingRecords } = await supabase
      .from('student_attendance')
      .select('*')
      .eq('attendance_session_id', session.id);

    const recordsMap = new Map((existingRecords || []).map(r => [r.student_id, r]));

    const sheetData = classStudents.map(st => {
      const existing = recordsMap.get(st.id);
      return {
        student: st,
        enrollment_id: st.enrollment_id || st.id,
        status: (existing?.status as any) || 'present',
        arrival_time: existing?.arrival_time || '',
        justification: existing?.justification || ''
      };
    });

    setSheetRecords(sheetData);
    setShowTakeAttendanceModal(true);
  };

  const handleSaveAttendanceSheet = async (complete: boolean) => {
    if (!selectedSession) return;
    setSavingAttendance(true);

    try {
      for (const item of sheetRecords) {
        const { error } = await supabase.rpc('update_student_attendance', {
          p_session_id: selectedSession.id,
          p_student_id: item.student.id,
          p_status: item.status,
          p_arrival_time: item.arrival_time || null,
          p_justification: item.justification.trim() || null
        });

        if (error) throw error;
      }

      if (complete) {
        const { error: compErr } = await supabase.rpc('complete_attendance_session', {
          p_session_id: selectedSession.id
        });
        if (compErr) throw compErr;
      }

      showToast(
        complete ? 'Appel de présence finalisé avec succès !' : 'Brouillon enregistré avec succès !',
        'success'
      );
      setShowTakeAttendanceModal(false);
      loadTeacherPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’enregistrement de l’appel.', 'warning');
    } finally {
      setSavingAttendance(false);
    }
  };

  // Update Profile Phone
  const handleUpdatePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teacherRecord?.id) return;
    setUpdatingPhone(true);

    try {
      const { error } = await supabase
        .from('teachers')
        .update({ phone: teacherPhone.trim(), updated_at: new Date().toISOString() })
        .eq('id', teacherRecord.id);

      if (error) throw error;

      showToast('Numéro de téléphone mis à jour avec succès !', 'success');
      loadTeacherPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la mise à jour.', 'warning');
    } finally {
      setUpdatingPhone(false);
    }
  };

  // --- HANDLERS DEVOIRS (HOMEWORK) ---
  const resetHwForm = () => {
    setHwClassId('');
    setHwSubjectId('');
    setHwTitle('');
    setHwInstructions('');
    setHwAssignedOn(new Date().toISOString().split('T')[0]);
    setHomeworkDueDate('');
    setHomeworkDueTime('');
    setHwEstimatedMinutes('');
    setHwPublishNow(false);
    setActionReason('');
  };

  const handleCreateHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hwClassId || !hwSubjectId || !hwTitle.trim() || !hwInstructions.trim()) {
      showToast('Veuillez remplir tous les champs obligatoires.', 'warning');
      return;
    }

    if (!homeworkDueDate || !homeworkDueTime) {
      showToast('Veuillez spécifier la date ET l’heure d’échéance du devoir.', 'warning');
      return;
    }

    const localDueDateTime = new Date(`${homeworkDueDate}T${homeworkDueTime}:00`);

    if (isNaN(localDueDateTime.getTime())) {
      showToast('La date et l’heure d’échéance saisies sont invalides.', 'warning');
      return;
    }

    if (localDueDateTime.getTime() <= Date.now()) {
      showToast('La date et l’heure d’échéance doivent être strictement postérieures à l’heure actuelle.', 'warning');
      return;
    }

    setSubmittingHw(true);
    try {
      const { error } = await supabase.rpc('create_teacher_homework', {
        p_class_id: hwClassId,
        p_subject_id: hwSubjectId,
        p_title: hwTitle.trim(),
        p_instructions: hwInstructions.trim(),
        p_assigned_on: hwAssignedOn,
        p_due_at: localDueDateTime.toISOString(),
        p_estimated_minutes: hwEstimatedMinutes ? parseInt(hwEstimatedMinutes) : null,
        p_publish_now: hwPublishNow
      });

      if (error) throw error;

      showToast(hwPublishNow ? 'Devoir publié avec succès !' : 'Devoir enregistré comme brouillon.', 'success');
      setShowCreateHwModal(false);
      resetHwForm();
      await loadTeacherPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création du devoir.', 'warning');
    } finally {
      setSubmittingHw(false);
    }
  };

  const handlePublishHomework = async (hw: HomeworkRow) => {
    try {
      const { error } = await supabase.rpc('publish_teacher_homework', { p_homework_id: hw.id });
      if (error) throw error;
      showToast('Devoir publié avec succès !', 'success');
      if (showDetailHwModal) setShowDetailHwModal(false);
      await loadTeacherPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la publication du devoir.', 'warning');
    }
  };

  const handleCloseHomework = async (hw: HomeworkRow) => {
    try {
      const { error } = await supabase.rpc('close_teacher_homework', { p_homework_id: hw.id });
      if (error) throw error;
      showToast('Devoir clôturé avec succès.', 'success');
      if (showDetailHwModal) setShowDetailHwModal(false);
      await loadTeacherPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la clôture du devoir.', 'warning');
    }
  };

  const handleCancelHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHw) return;
    if (!actionReason.trim()) {
      showToast('Un motif explicite est obligatoire pour annuler un devoir.', 'warning');
      return;
    }

    setSubmittingAction(true);
    try {
      const { error } = await supabase.rpc('cancel_teacher_homework', {
        p_homework_id: selectedHw.id,
        p_reason: actionReason.trim()
      });

      if (error) throw error;

      showToast('Devoir annulé avec succès.', 'success');
      setShowCancelHwModal(false);
      if (showDetailHwModal) setShowDetailHwModal(false);
      setActionReason('');
      await loadTeacherPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’annulation du devoir.', 'warning');
    } finally {
      setSubmittingAction(false);
    }
  };

  const openEditHwModal = (hw: HomeworkRow) => {
    setSelectedHw(hw);
    setHwTitle(hw.title);
    setHwInstructions(hw.instructions);
    setHwAssignedOn(hw.assigned_on);

    const d = new Date(hw.due_at);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      setHomeworkDueDate(`${year}-${month}-${day}`);

      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      setHomeworkDueTime(`${hours}:${minutes}`);
    } else {
      setHomeworkDueDate('');
      setHomeworkDueTime('');
    }

    setHwEstimatedMinutes(hw.estimated_minutes ? hw.estimated_minutes.toString() : '');
    setActionReason('');
    setShowEditHwModal(true);
  };

  const handleUpdateHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHw) return;
    if (!hwTitle.trim() || !hwInstructions.trim()) {
      showToast('Veuillez remplir tous les champs obligatoires.', 'warning');
      return;
    }

    if (!homeworkDueDate || !homeworkDueTime) {
      showToast('Veuillez spécifier la date ET l’heure d’échéance du devoir.', 'warning');
      return;
    }

    const localDueDateTime = new Date(`${homeworkDueDate}T${homeworkDueTime}:00`);

    if (isNaN(localDueDateTime.getTime())) {
      showToast('La date et l’heure d’échéance saisies sont invalides.', 'warning');
      return;
    }

    if (localDueDateTime.getTime() <= Date.now()) {
      showToast('La date et l’heure d’échéance doivent être strictement postérieures à l’heure actuelle.', 'warning');
      return;
    }

    if (selectedHw.status === 'published' && !actionReason.trim()) {
      showToast('Un motif explicite est obligatoire pour modifier un devoir déjà publié.', 'warning');
      return;
    }

    setSubmittingAction(true);
    try {
      const { error } = await supabase.rpc('update_teacher_homework', {
        p_homework_id: selectedHw.id,
        p_title: hwTitle.trim(),
        p_instructions: hwInstructions.trim(),
        p_assigned_on: hwAssignedOn,
        p_due_at: localDueDateTime.toISOString(),
        p_estimated_minutes: hwEstimatedMinutes ? parseInt(hwEstimatedMinutes) : null,
        p_term_id: selectedHw.term_id,
        p_reason: selectedHw.status === 'published' ? actionReason.trim() : null
      });

      if (error) throw error;

      showToast('Devoir mis à jour avec succès.', 'success');
      setShowEditHwModal(false);
      if (showDetailHwModal) setShowDetailHwModal(false);
      resetHwForm();
      await loadTeacherPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la modification du devoir.', 'warning');
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-400">Chargement de votre espace enseignant...</p>
      </div>
    );
  }

  if (accessError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-3xl max-w-md space-y-3">
          <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="font-extrabold text-white text-base">Accès Restreint</h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            {accessError}
          </p>
          <button
            onClick={() => signOutReal()}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer mt-2"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-slate-900/90 border-b border-slate-800 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-600 flex items-center justify-center text-slate-950 font-black shadow-lg">
              <BookOpen className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <span className="text-base font-black text-white tracking-tight">
                École<span className="text-amber-400">Connect</span>
              </span>
              <span className="ml-2 text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Espace Enseignant
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end text-xs">
              <span className="font-extrabold text-white">{profile?.first_name} {profile?.last_name}</span>
              <span className="text-[11px] text-slate-400">{school?.name}</span>
            </div>
            <button
              onClick={() => signOutReal()}
              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 border border-slate-700 transition-colors cursor-pointer"
              title="Déconnexion"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-1 overflow-x-auto no-scrollbar py-2 border-t border-slate-800/60 text-xs font-bold">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'overview' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Vue d'ensemble
          </button>
          <button
            onClick={() => setActiveTab('classes')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'classes' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Mes Classes ({groupedAssignments.length})
          </button>
          <button
            onClick={() => setActiveTab('presences')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'presences' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Présences
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'schedule' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Emploi du temps <span className="text-[9px] font-normal opacity-70">(Prochainement)</span>
          </button>
          <button
            onClick={() => setActiveTab('homework')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'homework' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Devoirs ({homeworkList.length})
          </button>
          <button
            onClick={() => setActiveTab('grades')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'grades' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Notes {gradesCount > 0 ? `(${gradesCount})` : ''}
          </button>
          <button
            onClick={() => {
              setActiveTab('finance');
              if (!selectedFinanceClassId && groupedAssignments.length > 0) {
                setSelectedFinanceClassId(groupedAssignments[0].class_id);
              }
            }}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'finance' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Statut Financier Classe
          </button>
          <button
            onClick={() => setActiveTab('messages')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'messages' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Messages <span className="text-[9px] font-normal opacity-70">(Prochainement)</span>
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors whitespace-nowrap ${
              activeTab === 'profile' ? 'bg-amber-500 text-slate-950 font-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Mon Profil
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full space-y-6">
        {/* Banner Welcome */}
        <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-extrabold uppercase">
                Compte Actif
              </span>
              <span className="text-xs text-slate-400 font-mono">Matricule : {teacherRecord?.employee_number || 'N/A'}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white">
              Bienvenue, {profile?.first_name} {profile?.last_name}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Enseignant(e) à <strong className="text-slate-200">{school?.name}</strong> • Spécialité : <strong className="text-amber-400">{teacherRecord?.specialty || 'Générale'}</strong>
            </p>
          </div>

          <button
            onClick={() => {
              if (assignments.length > 0) {
                setNewSessionClassId(assignments[0].class_id);
                setNewSessionSubjectId(assignments[0].subject_id || '');
              }
              setShowNewSessionModal(true);
            }}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer transition-all hover:scale-105"
          >
            <Plus className="w-4 h-4" />
            <span>Faire l'Appel de Présence</span>
          </button>
        </div>

        {/* TAB FINANCE */}
        {activeTab === 'finance' && (
          <div className="space-y-6">
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-wider block">
                  Sélection de la classe
                </span>
                <h3 className="text-sm font-bold text-white">Consulter le statut d'une classe attribuée</h3>
              </div>

              <select
                value={selectedFinanceClassId}
                onChange={(e) => setSelectedFinanceClassId(e.target.value)}
                className="w-full sm:w-64 bg-slate-950 border border-slate-700 text-white text-xs font-bold px-3 py-2 rounded-xl"
              >
                <option value="">-- Choisir une classe --</option>
                {groupedAssignments.map((g) => (
                  <option key={g.class_id} value={g.class_id}>
                    {g.class_name}
                  </option>
                ))}
              </select>
            </div>

            {selectedFinanceClassId ? (
              <TeacherClassFinanceOverview classId={selectedFinanceClassId} />
            ) : (
              <div className="p-8 bg-slate-900 border border-slate-800 rounded-3xl text-center text-xs text-slate-400">
                Veuillez sélectionner une classe ci-dessus pour afficher la synthèse de régularité.
              </div>
            )}
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Classes Attribuées</span>
                <p className="text-2xl font-black text-white">{groupedAssignments.length}</p>
                <span className="text-[10px] text-emerald-400 font-bold">Classes uniques</span>
              </div>
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Séances d'Appel</span>
                <p className="text-2xl font-black text-amber-400">{teacherSessions.length}</p>
                <span className="text-[10px] text-slate-400 font-medium">Créées par vous</span>
              </div>
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Brouillons à Finaliser</span>
                <p className="text-2xl font-black text-rose-400">
                  {teacherSessions.filter(s => s.status === 'draft').length}
                </p>
                <span className="text-[10px] text-slate-400 font-medium">En attente de clôture</span>
              </div>
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Élèves Enseignés</span>
                <p className="text-2xl font-black text-indigo-400">
                  {totalUniqueStudentsCount}
                </p>
                <span className="text-[10px] text-indigo-400 font-bold">Élèves uniques inscrits</span>
              </div>
            </div>

            {/* Recent Sessions & Assignments split */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* My Assigned Classes */}
              <div className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-white text-sm">Vos Classes & Matières</h3>
                  <button onClick={() => setActiveTab('classes')} className="text-xs text-amber-400 hover:underline font-bold">
                    Voir tout ➔
                  </button>
                </div>

                {groupedAssignments.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400 bg-slate-950 rounded-2xl border border-slate-800">
                    Aucune classe ne vous a été affectée pour le moment. Veuillez contacter votre administration.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupedAssignments.map(a => (
                      <div key={a.class_id} className="p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-extrabold text-white text-xs">{a.class_name}</p>
                            {a.is_homeroom && (
                              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-bold text-[10px]">
                                Titulaire
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-amber-400 font-medium">{a.subject_name}</span>
                        </div>
                        <button
                          onClick={() => {
                            const cls = classesList.find(c => c.id === a.class_id);
                            setSelectedClassForRoster(cls);
                            setShowClassStudentsModal(true);
                          }}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold rounded-xl cursor-pointer"
                        >
                          Élèves ({classStudentsMap[a.class_id]?.length || 0})
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Sessions */}
              <div className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-extrabold text-white text-sm">Dernières Séances d'Appel</h3>
                  <button onClick={() => setActiveTab('presences')} className="text-xs text-amber-400 hover:underline font-bold">
                    Toutes les séances ➔
                  </button>
                </div>

                {teacherSessions.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400 bg-slate-950 rounded-2xl border border-slate-800">
                    Vous n'avez pas encore créé de séance d'appel.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {teacherSessions.slice(0, 4).map(s => (
                      <div key={s.id} className="p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between text-xs">
                        <div>
                          <p className="font-bold text-white">{s.class_name} • <span className="text-slate-400">{s.subject_name}</span></p>
                          <span className="text-[10px] font-mono text-slate-500">{new Date(s.attendance_date).toLocaleDateString('fr-FR')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-0.5 rounded-full font-extrabold text-[10px] ${
                            s.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {s.status === 'completed' ? 'Finalisée' : 'Brouillon'}
                          </span>
                          <button
                            onClick={() => openAttendanceSheet(s)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold text-[11px] cursor-pointer"
                          >
                            {s.status === 'completed' ? 'Consulter' : 'Faire l\'appel'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MES CLASSES */}
        {activeTab === 'classes' && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold text-white">Vos Classes & Affectations Réelles</h2>

            {groupedAssignments.length === 0 ? (
              <div className="p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 text-slate-400 text-xs">
                Aucune affectation active pour le moment.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {groupedAssignments.map(a => {
                  const classStudents = classStudentsMap[a.class_id] || [];

                  return (
                    <div key={a.class_id} className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-extrabold text-white">{a.class_name}</span>
                          {a.is_homeroom && (
                            <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-bold text-[10px]">
                              Titulaire
                            </span>
                          )}
                        </div>
                        <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-bold text-[10px]">
                          Active
                        </span>
                      </div>

                      <div className="space-y-1 text-xs text-slate-300">
                        <p><strong className="text-slate-400">Rôle / Matière(s) :</strong> {a.subject_name}</p>
                        <p><strong className="text-slate-400">Élèves inscrits :</strong> {classStudents.length} élèves</p>
                      </div>

                      <div className="pt-2 flex gap-2">
                        <button
                          onClick={() => {
                            const cls = classesList.find(c => c.id === a.class_id);
                            setSelectedClassForRoster(cls);
                            setShowClassStudentsModal(true);
                          }}
                          className="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs cursor-pointer text-center"
                        >
                          Voir les élèves
                        </button>
                        <button
                          onClick={() => {
                            setNewSessionClassId(a.class_id);
                            setNewSessionSubjectId(a.subject_id || '');
                            setShowNewSessionModal(true);
                          }}
                          className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs cursor-pointer"
                        >
                          Faire l'appel
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PRÉSENCES */}
        {activeTab === 'presences' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-white">Gestion des Présences & Appel de Classe</h2>
                <p className="text-xs text-slate-400">Saisie des appels pour vos classes affectées.</p>
              </div>

              <button
                onClick={() => {
                  if (assignments.length > 0) {
                    setNewSessionClassId(assignments[0].class_id);
                    setNewSessionSubjectId(assignments[0].subject_id || '');
                  }
                  setShowNewSessionModal(true);
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl cursor-pointer flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Nouvelle Séance d'Appel</span>
              </button>
            </div>

            {/* Sessions Table */}
            {teacherSessions.length === 0 ? (
              <div className="p-8 text-center bg-slate-900 rounded-3xl border border-slate-800 text-slate-400 text-xs">
                Aucune séance d'appel enregistrée pour l'instant.
              </div>
            ) : (
              <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 font-bold uppercase text-[10px] tracking-wider border-b border-slate-800">
                      <tr>
                        <th className="p-4">Date Appel</th>
                        <th className="p-4">Classe</th>
                        <th className="p-4">Matière</th>
                        <th className="p-4">Statut</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {teacherSessions.map(s => (
                        <tr key={s.id} className="hover:bg-slate-800/40">
                          <td className="p-4 font-mono text-white font-bold">{new Date(s.attendance_date).toLocaleDateString('fr-FR')}</td>
                          <td className="p-4 font-extrabold text-white">{s.class_name}</td>
                          <td className="p-4 text-amber-400 font-medium">{s.subject_name}</td>
                          <td className="p-4">
                            <span className={`px-2.5 py-0.5 rounded-full font-extrabold text-[10px] ${
                              s.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            }`}>
                              {s.status === 'completed' ? 'Finalisée (Verrouillée)' : 'Brouillon'}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => openAttendanceSheet(s)}
                              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold cursor-pointer"
                            >
                              {s.status === 'completed' ? 'Consulter' : 'Remplir / Modifer'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: DEVOIRS */}
        {activeTab === 'homework' && (
          <div className="space-y-6">
            {/* Header Devoirs */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl">
              <div>
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  <BookOpen className="w-6 h-6 text-amber-400" />
                  <span>Gestion des Devoirs Scolaires</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Créez, publiez, suivez et gérez les devoirs pour vos classes attribuées.
                </p>
              </div>
              <button
                onClick={() => {
                  resetHwForm();
                  if (groupedAssignments.length > 0) {
                    setHwClassId(groupedAssignments[0].class_id);
                    const firstClassAssg = assignments.filter(a => a.class_id === groupedAssignments[0].class_id && a.subject_id);
                    if (firstClassAssg.length > 0 && firstClassAssg[0].subject_id) {
                      setHwSubjectId(firstClassAssg[0].subject_id);
                    }
                  }
                  setShowCreateHwModal(true);
                }}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-2xl flex items-center gap-2 shadow-lg cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Nouveau Devoir</span>
              </button>
            </div>

            {/* Filtres Bar */}
            <div className="flex flex-wrap items-center gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800 text-xs">
              <div className="flex items-center gap-1.5 text-slate-400 font-bold mr-2">
                <Filter className="w-4 h-4 text-amber-400" />
                <span>Filtres :</span>
              </div>

              {/* Filtre Classe */}
              <select
                value={hwClassFilter}
                onChange={e => setHwClassFilter(e.target.value)}
                className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="all">Toutes les classes ({groupedAssignments.length})</option>
                {groupedAssignments.map(g => (
                  <option key={g.class_id} value={g.class_id}>{g.class_name}</option>
                ))}
              </select>

              {/* Filtre Matière */}
              <select
                value={hwSubjectFilter}
                onChange={e => setHwSubjectFilter(e.target.value)}
                className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="all">Toutes les matières</option>
                {subjectsList.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              {/* Filtre Statut */}
              <select
                value={hwStatusFilter}
                onChange={e => setHwStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="all">Tous les statuts</option>
                <option value="draft">Brouillons</option>
                <option value="published">Publiés</option>
                <option value="closed">Clôturés</option>
                <option value="cancelled">Annulés</option>
              </select>
            </div>

            {/* Liste des Devoirs */}
            {(() => {
              const filteredList = homeworkList.filter(hw => {
                if (hwClassFilter !== 'all' && hw.class_id !== hwClassFilter) return false;
                if (hwSubjectFilter !== 'all' && hw.subject_id !== hwSubjectFilter) return false;
                if (hwStatusFilter !== 'all' && hw.status !== hwStatusFilter) return false;
                return true;
              });

              if (filteredList.length === 0) {
                return (
                  <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
                    <FileText className="w-12 h-12 text-slate-600 mx-auto" />
                    <p className="text-sm font-bold text-slate-300">Aucun devoir trouvé</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Aucun devoir ne correspond à vos critères de recherche ou vous n'avez pas encore créé de devoir.
                    </p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredList.map(hw => {
                    const isOverdue = hw.status === 'published' && new Date(hw.due_at) < new Date();
                    return (
                      <div
                        key={hw.id}
                        className="bg-slate-900 p-5 rounded-3xl border border-slate-800 space-y-4 hover:border-slate-700 transition-all flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          {/* Badges Header */}
                          <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] font-bold">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2.5 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-lg">
                                {hw.class_name}
                              </span>
                              <span className="px-2.5 py-1 bg-slate-800 text-slate-300 rounded-lg">
                                {hw.subject_name}
                              </span>
                            </div>
                            <div>
                              {hw.status === 'draft' && (
                                <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg">
                                  Brouillon
                                </span>
                              )}
                              {hw.status === 'published' && !isOverdue && (
                                <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg">
                                  Publié
                                </span>
                              )}
                              {hw.status === 'published' && isOverdue && (
                                <span className="px-2.5 py-1 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-lg font-black animate-pulse">
                                  En retard
                                </span>
                              )}
                              {hw.status === 'closed' && (
                                <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-lg">
                                  Clôturé
                                </span>
                              )}
                              {hw.status === 'cancelled' && (
                                <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-lg">
                                  Annulé
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Title & Instructions preview */}
                          <div>
                            <h3 className="text-sm font-extrabold text-white line-clamp-1">{hw.title}</h3>
                            <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                              {hw.instructions}
                            </p>
                          </div>

                          {/* Metadata */}
                          <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px]">
                            <div>
                              <span className="text-slate-500 block">Assigné le</span>
                              <span className="text-slate-300 font-medium">{new Date(hw.assigned_on).toLocaleDateString('fr-FR')}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 block">Échéance</span>
                              <span className={`font-bold ${isOverdue ? 'text-rose-400' : 'text-amber-400'}`}>
                                {new Date(hw.due_at).toLocaleDateString('fr-FR')} à {new Date(hw.due_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            {hw.estimated_minutes && (
                              <div className="col-span-2 text-slate-400 text-[10px]">
                                Durée estimée : <strong className="text-slate-200">{hw.estimated_minutes} min</strong>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                          <button
                            onClick={() => {
                              setSelectedHw(hw);
                              setShowDetailHwModal(true);
                            }}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
                          >
                            Détails
                          </button>
                          <div className="flex items-center gap-1.5">
                            {hw.status === 'draft' && (
                              <button
                                onClick={() => handlePublishHomework(hw)}
                                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Publier</span>
                              </button>
                            )}
                            {hw.status === 'published' && (
                              <button
                                onClick={() => handleCloseHomework(hw)}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Clôturer</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB: GRADES */}
        {activeTab === 'grades' && (
          <TeacherGradesModule
            assignments={assignments}
            classesList={classesList}
            subjectsList={subjectsList}
            schoolTerms={schoolTermsList}
            schoolPeriods={schoolPeriodsList}
            teacherRecord={teacherRecord}
            onStatsChange={count => setGradesCount(count)}
          />
        )}

        {/* FUTURE TABS: PROCHAINEMENT */}
        {(activeTab === 'schedule' || activeTab === 'messages') && (
          <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="w-16 h-16 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-3xl flex items-center justify-center mx-auto">
              <Clock className="w-8 h-8" />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h2 className="text-xl font-extrabold text-white">Module Enseignant — Prochainement</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ce module professionnel est en cours de déploiement sécurisé. Aucune donnée fictive n'est affichée dans votre portail de production.
              </p>
            </div>
          </div>
        )}

        {/* TAB: PROFILE */}
        {activeTab === 'profile' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-6">
              <h2 className="text-lg font-extrabold text-white border-b border-slate-800 pb-3">Profil Enseignant Professionnel</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Prénom & Nom :</span>
                  <p className="font-extrabold text-white text-sm">{profile?.first_name} {profile?.last_name}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Matricule Employé :</span>
                  <p className="font-mono text-amber-400 font-bold text-sm">{teacherRecord?.employee_number || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Email Professionnel :</span>
                  <p className="font-mono text-slate-200">{user?.email || teacherRecord?.email}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Spécialité :</span>
                  <p className="font-bold text-slate-200">{teacherRecord?.specialty || 'Générale'}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Établissement Scolaire :</span>
                  <p className="font-bold text-slate-200">{school?.name}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Statut d'Emploi :</span>
                  <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-extrabold uppercase text-[10px]">
                    {teacherRecord?.employment_status || 'Actif'}
                  </span>
                </div>
              </div>

              {/* Form Phone update */}
              <form onSubmit={handleUpdatePhone} className="pt-4 border-t border-slate-800 space-y-3">
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider">
                  Numéro de Téléphone Personnel (Modifiable)
                </label>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={teacherPhone}
                    onChange={e => setTeacherPhone(e.target.value)}
                    placeholder="+243..."
                    className="flex-1 px-3.5 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                  />
                  <button
                    type="submit"
                    disabled={updatingPhone}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs cursor-pointer"
                  >
                    {updatingPhone ? 'Mise à jour...' : 'Sauvegarder'}
                  </button>
                </div>
              </form>
            </div>

            {/* Signature Officielle */}
            <TeacherOfficialSignatureCard
              teacherRecord={teacherRecord}
              onSignatureUpdated={(url) => {
                setTeacherRecord((prev: any) => prev ? { ...prev, signature_url: url } : prev);
              }}
            />
          </div>
        )}
      </main>

      {/* MODAL 1: Créer une séance d'appel */}
      {showNewSessionModal && (
        <Modal
          isOpen={showNewSessionModal}
          onClose={() => setShowNewSessionModal(false)}
          title="Créer une Séance d'Appel de Présence"
          darkMode={true}
        >
          <form onSubmit={handleCreateSession} className="space-y-4 text-xs">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Sélectionner la Classe *
              </label>
              <select
                required
                value={newSessionClassId}
                onChange={e => {
                  setNewSessionClassId(e.target.value);
                  const firstAssign = assignments.find(a => a.class_id === e.target.value);
                  if (firstAssign) setNewSessionSubjectId(firstAssign.subject_id || '');
                }}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="">-- Choisissez une classe attribuée --</option>
                {groupedAssignments.map(g => (
                  <option key={g.class_id} value={g.class_id} className="bg-slate-900 text-white">
                    {g.class_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Date de l'Appel *
              </label>
              <input
                type="date"
                required
                value={newSessionDate}
                onChange={e => setNewSessionDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowNewSessionModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={creatingSession || !newSessionClassId}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 rounded-xl cursor-pointer"
              >
                {creatingSession ? 'Création...' : 'Créer et Faire l\'Appel'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: Saisie Interactive de l'Appel */}
      {selectedSession && showTakeAttendanceModal && (
        <Modal
          isOpen={showTakeAttendanceModal}
          onClose={() => setShowTakeAttendanceModal(false)}
          title={`Appel de Présence — ${selectedSession.class_name} (${new Date(selectedSession.attendance_date).toLocaleDateString('fr-FR')})`}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-extrabold text-white">Élèves : {sheetRecords.length}</span>
                <p className="text-[11px] text-slate-400">Statut séance : <strong className="text-amber-400">{selectedSession.status}</strong></p>
              </div>
              {selectedSession.status !== 'completed' && (
                <button
                  type="button"
                  onClick={() => setSheetRecords(prev => prev.map(item => ({ ...item, status: 'present' })))}
                  className="px-3.5 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl font-extrabold text-xs cursor-pointer"
                >
                  ✓ Tout marquer Présents
                </button>
              )}
            </div>

            {sheetRecords.length === 0 ? (
              <div className="p-6 text-center bg-slate-950 rounded-xl text-slate-400">
                Aucun élève inscrit dans cette classe.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {sheetRecords.map((item, idx) => (
                  <div key={item.student.id} className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono text-amber-400 font-bold">#{idx + 1} </span>
                        <span className="font-extrabold text-white text-xs">{item.student.first_name} {item.student.last_name}</span>
                        <p className="text-[10px] text-slate-400 font-mono">{item.student.student_number}</p>
                      </div>

                      {selectedSession.status === 'completed' ? (
                        <span className={`px-2.5 py-1 rounded-xl font-extrabold text-xs uppercase ${
                          item.status === 'present' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {item.status}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          {(['present', 'absent', 'late', 'excused'] as const).map(st => (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setSheetRecords(prev => prev.map(r => r.student.id === item.student.id ? { ...r, status: st } : r))}
                              className={`px-2 py-1 rounded-lg font-bold text-[10px] capitalize cursor-pointer ${
                                item.status === st ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-900 text-slate-400 border border-slate-800'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowTakeAttendanceModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Fermer
              </button>

              {selectedSession.status !== 'completed' && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleSaveAttendanceSheet(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs cursor-pointer"
                  >
                    Enregistrer Brouillon
                  </button>
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleSaveAttendanceSheet(true)}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs cursor-pointer shadow-md"
                  >
                    Finaliser l'Appel
                  </button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 3: Voir la liste restreinte des élèves d'une classe */}
      {selectedClassForRoster && showClassStudentsModal && (
        <Modal
          isOpen={showClassStudentsModal}
          onClose={() => setShowClassStudentsModal(false)}
          title={`Registre Classe — ${selectedClassForRoster.name}`}
          darkMode={true}
        >
          <div className="space-y-3 text-xs">
            <p className="text-slate-400">
              Liste des élèves activement inscrits dans la classe <strong>{selectedClassForRoster.name}</strong>.
            </p>

            {!(classStudentsMap[selectedClassForRoster.id]?.length) ? (
              <div className="p-6 text-center bg-slate-950 rounded-2xl text-slate-400">
                Aucun élève inscrit dans cette classe.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-1.5">
                {classStudentsMap[selectedClassForRoster.id].map((st, idx) => (
                  <div key={st.id} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="font-mono text-amber-400 font-bold mr-2">#{idx + 1}</span>
                      <span className="font-extrabold text-white">{st.first_name} {st.last_name}</span>
                    </div>
                    <span className="font-mono text-slate-400 text-[10px]">{st.student_number}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowClassStudentsModal(false)}
                className="px-4 py-2 bg-slate-800 text-white rounded-xl font-bold cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CRÉER UN DEVOIR */}
      {showCreateHwModal && (
        <Modal
          isOpen={showCreateHwModal}
          onClose={() => setShowCreateHwModal(false)}
          title="Nouveau Devoir Scolaire"
        >
          <form onSubmit={handleCreateHomework} className="space-y-4 text-xs">
            {/* Classe & Matière */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Classe Attribuée *</label>
                <select
                  value={hwClassId}
                  onChange={e => {
                    setHwClassId(e.target.value);
                    const classAssg = assignments.filter(a => a.class_id === e.target.value && a.subject_id);
                    if (classAssg.length > 0 && classAssg[0].subject_id) {
                      setHwSubjectId(classAssg[0].subject_id);
                    } else {
                      setHwSubjectId('');
                    }
                  }}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs font-medium focus:outline-none focus:border-amber-500"
                >
                  <option value="">Sélectionner une classe...</option>
                  {groupedAssignments.map(g => (
                    <option key={g.class_id} value={g.class_id}>{g.class_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Matière Attribuée *</label>
                <select
                  value={hwSubjectId}
                  onChange={e => setHwSubjectId(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs font-medium focus:outline-none focus:border-amber-500"
                >
                  <option value="">Sélectionner une matière...</option>
                  {assignments
                    .filter(a => a.class_id === hwClassId && a.subject_id)
                    .map(a => {
                      const sbj = subjectsList.find(s => s.id === a.subject_id);
                      return (
                        <option key={a.subject_id} value={a.subject_id!}>
                          {sbj ? sbj.name : 'Matière'}
                        </option>
                      );
                    })}
                </select>
              </div>
            </div>

            {/* Titre */}
            <div>
              <label className="block font-bold text-slate-300 mb-1">Titre du Devoir *</label>
              <input
                type="text"
                value={hwTitle}
                onChange={e => setHwTitle(e.target.value)}
                placeholder="Ex: Exercices 1 à 5 - Chapitre 3"
                required
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Consignes */}
            <div>
              <label className="block font-bold text-slate-300 mb-1">Consignes et Instructions *</label>
              <textarea
                value={hwInstructions}
                onChange={e => setHwInstructions(e.target.value)}
                rows={4}
                placeholder="Détaillez clairement le travail à effectuer par l'élève..."
                required
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500 resize-y"
              />
            </div>

            {/* Dates & Durée */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Date d'Assignation *</label>
                <input
                  type="date"
                  value={hwAssignedOn}
                  onChange={e => setHwAssignedOn(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Durée Estimée (min)</label>
                <input
                  type="number"
                  min={1}
                  value={hwEstimatedMinutes}
                  onChange={e => setHwEstimatedMinutes(e.target.value)}
                  placeholder="Ex: 45"
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Date d'Échéance *</label>
                <input
                  type="date"
                  value={homeworkDueDate}
                  onChange={e => setHomeworkDueDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Heure d'Échéance *</label>
                <input
                  type="time"
                  value={homeworkDueTime}
                  onChange={e => setHomeworkDueTime(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Option Publication Immédiate */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-bold text-white block">Publier immédiatement</span>
                <span className="text-[11px] text-slate-400">Rendre le devoir immédiatement visible aux élèves et parents.</span>
              </div>
              <input
                type="checkbox"
                checked={hwPublishNow}
                onChange={e => setHwPublishNow(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 bg-slate-900 border-slate-700 cursor-pointer"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCreateHwModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingHw}
                onClick={() => setHwPublishNow(false)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold cursor-pointer transition-colors"
              >
                {submittingHw ? 'Enregistrement...' : 'Enregistrer Brouillon'}
              </button>
              <button
                type="submit"
                disabled={submittingHw}
                onClick={() => setHwPublishNow(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl cursor-pointer transition-colors"
              >
                {submittingHw ? 'Publication...' : 'Publier Immédiatement'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: DETAILS DEVOIR */}
      {showDetailHwModal && selectedHw && (
        <Modal
          isOpen={showDetailHwModal}
          onClose={() => setShowDetailHwModal(false)}
          title={`Devoir : ${selectedHw.title}`}
        >
          <div className="space-y-5 text-xs">
            {/* Header info */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-lg font-bold">
                    {selectedHw.class_name}
                  </span>
                  <span className="px-2.5 py-1 bg-slate-800 text-slate-300 rounded-lg font-bold">
                    {selectedHw.subject_name}
                  </span>
                </div>
                <div>
                  {selectedHw.status === 'draft' && (
                    <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg font-bold">
                      Brouillon
                    </span>
                  )}
                  {selectedHw.status === 'published' && new Date(selectedHw.due_at) >= new Date() && (
                    <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg font-bold">
                      Publié
                    </span>
                  )}
                  {selectedHw.status === 'published' && new Date(selectedHw.due_at) < new Date() && (
                    <span className="px-2.5 py-1 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-lg font-black animate-pulse">
                      En retard
                    </span>
                  )}
                  {selectedHw.status === 'closed' && (
                    <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-lg font-bold">
                      Clôturé
                    </span>
                  )}
                  {selectedHw.status === 'cancelled' && (
                    <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-lg font-bold">
                      Annulé
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-slate-400 pt-2 border-t border-slate-800/60">
                <div>Assigné le : <strong className="text-white">{new Date(selectedHw.assigned_on).toLocaleDateString('fr-FR')}</strong></div>
                <div>Échéance : <strong className="text-amber-400">{new Date(selectedHw.due_at).toLocaleDateString('fr-FR')} à {new Date(selectedHw.due_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
                {selectedHw.estimated_minutes && <div>Durée estimée : <strong className="text-white">{selectedHw.estimated_minutes} min</strong></div>}
              </div>
            </div>

            {/* Consignes */}
            <div className="space-y-1.5">
              <span className="font-bold text-slate-300">Consignes & Instructions :</span>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-slate-300 whitespace-pre-wrap leading-relaxed">
                {selectedHw.instructions}
              </div>
            </div>

            {/* Actions Bar */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800 flex-wrap">
              <button
                type="button"
                onClick={() => setShowDetailHwModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Fermer
              </button>

              <div className="flex items-center gap-2 flex-wrap">
                {selectedHw.status === 'draft' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDetailHwModal(false);
                        openEditHwModal(selectedHw);
                      }}
                      className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Modifier</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePublishHomework(selectedHw)}
                      className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-black flex items-center gap-1.5 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Publier</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHw(selectedHw);
                        setActionReason('');
                        setShowCancelHwModal(true);
                      }}
                      className="px-3.5 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Annuler</span>
                    </button>
                  </>
                )}

                {selectedHw.status === 'published' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDetailHwModal(false);
                        openEditHwModal(selectedHw);
                      }}
                      className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Modifier (avec motif)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCloseHomework(selectedHw)}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Clôturer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHw(selectedHw);
                        setActionReason('');
                        setShowCancelHwModal(true);
                      }}
                      className="px-3.5 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Annuler (avec motif)</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: MODIFIER UN DEVOIR */}
      {showEditHwModal && selectedHw && (
        <Modal
          isOpen={showEditHwModal}
          onClose={() => setShowEditHwModal(false)}
          title={`Modifier Devoir : ${selectedHw.title}`}
        >
          <form onSubmit={handleUpdateHomework} className="space-y-4 text-xs">
            {selectedHw.status === 'published' && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>Ce devoir est déjà publié. Toute modification sera tracée et exige un motif explicite d'audit.</span>
              </div>
            )}

            <div>
              <label className="block font-bold text-slate-300 mb-1">Titre du Devoir *</label>
              <input
                type="text"
                value={hwTitle}
                onChange={e => setHwTitle(e.target.value)}
                required
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Consignes et Instructions *</label>
              <textarea
                value={hwInstructions}
                onChange={e => setHwInstructions(e.target.value)}
                rows={4}
                required
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500 resize-y"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Date d'Assignation *</label>
                <input
                  type="date"
                  value={hwAssignedOn}
                  onChange={e => setHwAssignedOn(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Durée Estimée (min)</label>
                <input
                  type="number"
                  min={1}
                  value={hwEstimatedMinutes}
                  onChange={e => setHwEstimatedMinutes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Date d'Échéance *</label>
                <input
                  type="date"
                  value={homeworkDueDate}
                  onChange={e => setHomeworkDueDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-300 mb-1">Heure d'Échéance *</label>
                <input
                  type="time"
                  value={homeworkDueTime}
                  onChange={e => setHomeworkDueTime(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {selectedHw.status === 'published' && (
              <div>
                <label className="block font-bold text-amber-400 mb-1">Motif explicite de la modification *</label>
                <textarea
                  value={actionReason}
                  onChange={e => setActionReason(e.target.value)}
                  rows={2}
                  placeholder="Ex: Correction de la date d'échéance et précision sur l'exercice 3."
                  required
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-amber-500/40 text-xs focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowEditHwModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingAction}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl cursor-pointer transition-colors"
              >
                {submittingAction ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: ANNULER UN DEVOIR */}
      {showCancelHwModal && selectedHw && (
        <Modal
          isOpen={showCancelHwModal}
          onClose={() => setShowCancelHwModal(false)}
          title={`Annuler Devoir : ${selectedHw.title}`}
        >
          <form onSubmit={handleCancelHomework} className="space-y-4 text-xs">
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>L'annulation d'un devoir est irréversible. Les élèves ne seront plus invités à soumettre ce travail.</span>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif explicite d'annulation *</label>
              <textarea
                value={actionReason}
                onChange={e => setActionReason(e.target.value)}
                rows={3}
                placeholder="Ex: Devoir annulé suite à l'avancement du programme ou report au trimestre suivant..."
                required
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCancelHwModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Retour
              </button>
              <button
                type="submit"
                disabled={submittingAction}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-xl cursor-pointer transition-colors"
              >
                {submittingAction ? 'Annulation...' : 'Confirmer l’annulation'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Footer */}
      <footer className="p-4 sm:p-6 border-t border-slate-900 text-center text-xs text-slate-500">
        ÉcoleConnect — Espace Enseignant ({school?.name})
      </footer>
    </div>
  );
};
