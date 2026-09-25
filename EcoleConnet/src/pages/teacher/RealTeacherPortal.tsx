// Portail Enseignant Réel ÉcoleConnect — Design Modernisé (Lot 2G)
// Fichier : src/pages/teacher/RealTeacherPortal.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../../components/common/Modal';
import { 
  Clock, Plus, AlertCircle,
  School, Users, CalendarCheck, Phone
} from 'lucide-react';

import { TeacherGradesModule } from '../../components/teacher/TeacherGradesModule';
import { TeacherOfficialSignatureCard } from '../../components/teacher/TeacherOfficialSignatureCard';
import { TeacherClassFinanceOverview } from '../../components/teacher/TeacherClassFinanceOverview';

// Sub-composants du Design Modernisé
import { TeacherPortalSidebar } from '../../components/teacher/portal/TeacherPortalSidebar';
import { TeacherPortalHeader } from '../../components/teacher/portal/TeacherPortalHeader';
import { TeacherTimetableModule } from '../../components/teacher/TeacherTimetableModule';
import { TeacherHomeworkModule } from '../../components/teacher/TeacherHomeworkModule';
import { SchoolMessagingModule } from '../../components/messaging/SchoolMessagingModule';

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
  const { profile, school, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  // Navigation & Mobile Drawer State
  const [activeTab, setActiveTab] = useState<TeacherTab>('overview');
  const [isOpenMobile, setIsOpenMobile] = useState<boolean>(false);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
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

  // Race control ref to ignore stale async responses
  const fetchRequestIdRef = useRef<number>(0);

  // Class Selection Handler with immediate dependent state reset
  const handleSelectClassId = (classId: string) => {
    setSelectedClassId(classId);
    setSelectedFinanceClassId(classId);
    setSelectedClassForRoster(null);
  };

  // Load Real Data for Logged-in Teacher
  const loadTeacherPortalData = useCallback(async () => {
    if (!profile?.id || !school?.id) return;
    const currentRequestId = ++fetchRequestIdRef.current;
    setLoading(true);
    setAccessError(null);

    try {
      // 1. Charger et vérifier le dossier enseignant
      const { data: tchData, error: tchErr } = await supabase
        .from('teachers')
        .select('*')
        .eq('profile_id', profile.id)
        .single();

      if (currentRequestId !== fetchRequestIdRef.current) return;

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

      if (currentRequestId !== fetchRequestIdRef.current) return;

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

      if (currentRequestId !== fetchRequestIdRef.current) return;

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

      // 5. Regrouper les affectations par classe unique sans doublon
      const classGroupMap = new Map<string, {
        id: string;
        class_id: string;
        class_name: string;
        is_homeroom: boolean;
        subject_id: string | null;
        subjects: string[];
        subject_name: string;
      }>();

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

      // 6. Extraire les class_id des classes réellement attribuées
      const activeAssignedClassIds = new Set(grouped.map(g => g.class_id));

      // 7. Charger les élèves via la RPC sécurisée get_teacher_assigned_students()
      const { data: assignedStudents } = await supabase.rpc('get_teacher_assigned_students');

      if (currentRequestId !== fetchRequestIdRef.current) return;

      // 8. Filtrer les élèves appartenant aux classes affichées
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

      // 9. Dédupliquer le nombre d'élèves uniques
      const uniqueDisplayedStudentIds = new Set(
        studentsInDisplayedClasses.map((st: any) => st.student_id)
      );
      setTotalUniqueStudentsCount(uniqueDisplayedStudentIds.size);

      // 10. Charger les séances d'appel
      const { data: sessData } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('school_id', school.id)
        .order('attendance_date', { ascending: false });

      if (currentRequestId !== fetchRequestIdRef.current) return;

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

      // 11. Charger les devoirs réels via RPC
      const { data: hwData } = await supabase.rpc('get_teacher_homework');

      if (currentRequestId !== fetchRequestIdRef.current) return;

      setHomeworkList((hwData || []) as HomeworkRow[]);
    } catch (err: any) {
      if (currentRequestId === fetchRequestIdRef.current) {
        showToast(err.message || 'Erreur lors du chargement de vos données d’enseignant.', 'warning');
      }
    } finally {
      if (currentRequestId === fetchRequestIdRef.current) {
        setLoading(false);
      }
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

  // Handlers Devoirs
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
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement sécurisé de votre Espace Enseignant...</p>
      </div>
    );
  }

  if (accessError) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="p-6 bg-slate-950 border border-slate-800 rounded-3xl max-w-md space-y-3 shadow-xl">
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

  const teacherFullName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Enseignant';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Sidebar Navigation */}
      <TeacherPortalSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpenMobile={isOpenMobile}
        onCloseMobile={() => setIsOpenMobile(false)}
        teacherName={teacherFullName}
        schoolName={school?.name}
        specialty={teacherRecord?.specialty}
        assignedClassesCount={groupedAssignments.length}
        homeworkCount={homeworkList.length}
        gradesCount={gradesCount}
        onSignOut={signOutReal}
      />

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen bg-slate-50">
        {/* Top Header */}
        <TeacherPortalHeader
          schoolName={school?.name}
          teacherName={teacherFullName}
          employeeNumber={teacherRecord?.employee_number}
          specialty={teacherRecord?.specialty}
          employmentStatus={teacherRecord?.employment_status}
          groupedClasses={groupedAssignments}
          selectedClassId={selectedClassId}
          onSelectClass={handleSelectClassId}
          onOpenMobileMenu={() => setIsOpenMobile(true)}
          onSignOut={signOutReal}
        />

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
          {/* Welcome Banner Ribbon */}
          <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950 rounded-3xl border border-slate-800 text-white flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-extrabold uppercase">
                  Compte Actif
                </span>
                {teacherRecord?.employee_number && (
                  <span className="text-xs text-slate-400 font-mono">
                    Matricule : {teacherRecord.employee_number}
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Bienvenue, {teacherFullName}
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                Enseignant(e) à <strong className="text-white">{school?.name}</strong>
                {teacherRecord?.specialty && (
                  <> • Spécialité : <strong className="text-amber-400">{teacherRecord.specialty}</strong></>
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (assignments.length > 0) {
                  setNewSessionClassId(assignments[0].class_id);
                  setNewSessionSubjectId(assignments[0].subject_id || '');
                }
                setShowNewSessionModal(true);
              }}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer transition-all hover:scale-105 shrink-0"
            >
              <CalendarCheck className="w-4 h-4" />
              <span>Faire l'Appel de Présence</span>
            </button>
          </div>

          {/* TAB: FINANCE */}
          {activeTab === 'finance' && (
            <div className="space-y-6 animate-fade-in">
              <div className="p-5 bg-white border border-slate-200 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
                <div>
                  <span className="text-[10px] font-extrabold text-amber-700 uppercase tracking-wider block">
                    Sélection de la classe
                  </span>
                  <h3 className="text-sm font-bold text-slate-900">Consulter le statut financier d'une classe attribuée</h3>
                </div>

                <select
                  value={selectedFinanceClassId}
                  onChange={(e) => setSelectedFinanceClassId(e.target.value)}
                  className="w-full sm:w-64 bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold px-3 py-2 rounded-xl focus:outline-none focus:border-amber-500"
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
                <div className="p-8 bg-white border border-slate-200 rounded-3xl text-center text-xs text-slate-500 shadow-xs">
                  Veuillez sélectionner une classe ci-dessus pour afficher la synthèse de régularité financière.
                </div>
              )}
            </div>
          )}

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-fade-in">
              {/* KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Classes Attribuées</span>
                    <School className="w-5 h-5 text-amber-600" />
                  </div>
                  <p className="text-2xl font-black text-slate-900">{groupedAssignments.length}</p>
                  <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full inline-block">
                    Classes uniques
                  </span>
                </div>

                <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Séances d'Appel</span>
                    <CalendarCheck className="w-5 h-5 text-blue-600" />
                  </div>
                  <p className="text-2xl font-black text-blue-900">{teacherSessions.length}</p>
                  <span className="text-[10px] text-slate-500 font-medium">Créées sur la plateforme</span>
                </div>

                <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Brouillons d'Appel</span>
                    <Clock className="w-5 h-5 text-amber-500" />
                  </div>
                  <p className="text-2xl font-black text-amber-600">
                    {teacherSessions.filter(s => s.status === 'draft').length}
                  </p>
                  <span className="text-[10px] text-slate-500 font-medium">En attente de clôture</span>
                </div>

                <div className="p-5 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Élèves Enseignés</span>
                    <Users className="w-5 h-5 text-indigo-600" />
                  </div>
                  <p className="text-2xl font-black text-indigo-900">
                    {totalUniqueStudentsCount}
                  </p>
                  <span className="text-[10px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-full inline-block">
                    Élèves uniques inscrits
                  </span>
                </div>
              </div>

              {/* Recent Sessions & Assignments Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* My Assigned Classes */}
                <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                      <School className="w-4 h-4 text-amber-600" />
                      <span>Vos Classes & Matières Affectées</span>
                    </h3>
                    <button onClick={() => setActiveTab('classes')} className="text-xs text-amber-700 hover:underline font-bold">
                      Voir tout ➔
                    </button>
                  </div>

                  {groupedAssignments.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                      Aucune classe ne vous a été affectée pour le moment. Veuillez contacter votre administration.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {groupedAssignments.map(a => (
                        <div key={a.class_id} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-extrabold text-slate-900 text-xs">{a.class_name}</p>
                              {a.is_homeroom && (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-200 rounded-full font-bold text-[10px]">
                                  Titulaire
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-amber-800 font-medium block mt-0.5">{a.subject_name}</span>
                          </div>
                          <button
                            onClick={() => {
                              const cls = classesList.find(c => c.id === a.class_id);
                              setSelectedClassForRoster(cls);
                              setShowClassStudentsModal(true);
                            }}
                            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 text-[11px] font-bold rounded-xl cursor-pointer transition-colors shadow-2xs"
                          >
                            Élèves ({classStudentsMap[a.class_id]?.length || 0})
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Sessions */}
                <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                      <CalendarCheck className="w-4 h-4 text-blue-600" />
                      <span>Dernières Séances d'Appel</span>
                    </h3>
                    <button onClick={() => setActiveTab('presences')} className="text-xs text-amber-700 hover:underline font-bold">
                      Toutes les séances ➔
                    </button>
                  </div>

                  {teacherSessions.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                      Vous n'avez pas encore créé de séance d'appel.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {teacherSessions.slice(0, 5).map(s => (
                        <div key={s.id} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-bold text-slate-900">{s.class_name} • <span className="text-slate-600">{s.subject_name}</span></p>
                            <span className="text-[10px] font-mono text-slate-500">{new Date(s.attendance_date).toLocaleDateString('fr-FR')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2.5 py-0.5 rounded-full font-extrabold text-[10px] ${
                              s.status === 'completed' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-amber-100 text-amber-900 border border-amber-200'
                            }`}>
                              {s.status === 'completed' ? 'Finalisée' : 'Brouillon'}
                            </span>
                            <button
                              onClick={() => openAttendanceSheet(s)}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold text-[11px] cursor-pointer"
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
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-slate-900">Vos Classes & Affectations Réelles</h2>
                <span className="text-xs text-slate-500 font-medium">
                  Total : {groupedAssignments.length} classe(s)
                </span>
              </div>

              {groupedAssignments.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 text-slate-500 text-xs shadow-xs">
                  Aucune affectation active pour le moment.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {groupedAssignments.map(a => {
                    const classStudents = classStudentsMap[a.class_id] || [];

                    return (
                      <div key={a.class_id} className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-extrabold text-slate-900">{a.class_name}</span>
                              {a.is_homeroom && (
                                <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-200 rounded-full font-bold text-[10px]">
                                  Titulaire
                                </span>
                              )}
                            </div>
                            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full font-bold text-[10px]">
                              Active
                            </span>
                          </div>

                          <div className="space-y-1.5 text-xs text-slate-600">
                            <p><strong className="text-slate-800">Rôle / Matière(s) :</strong> {a.subject_name}</p>
                            <p><strong className="text-slate-800">Élèves inscrits :</strong> {classStudents.length} élèves</p>
                          </div>
                        </div>

                        <div className="pt-2 flex gap-2 border-t border-slate-100">
                          <button
                            onClick={() => {
                              const cls = classesList.find(c => c.id === a.class_id);
                              setSelectedClassForRoster(cls);
                              setShowClassStudentsModal(true);
                            }}
                            className="flex-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs cursor-pointer text-center transition-colors"
                          >
                            Liste des élèves
                          </button>
                          <button
                            onClick={() => {
                              setNewSessionClassId(a.class_id);
                              setNewSessionSubjectId(a.subject_id || '');
                              setShowNewSessionModal(true);
                            }}
                            className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-bold text-xs cursor-pointer transition-colors"
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
            <div className="space-y-6 animate-fade-in">
              <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">Registre des Présences & Séances d'Appel</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Gérez et validez l'assiduité de vos élèves pour chaque cours
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (assignments.length > 0) {
                      setNewSessionClassId(assignments[0].class_id);
                      setNewSessionSubjectId(assignments[0].subject_id || '');
                    }
                    setShowNewSessionModal(true);
                  }}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nouvelle Séance d'Appel</span>
                </button>
              </div>

              {/* Sessions Table / List */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-5 border-b border-slate-100 font-extrabold text-slate-900 text-sm">
                  Historique des séances d'appel
                </div>

                {teacherSessions.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Aucune séance d'appel enregistrée. Cliquez sur "Nouvelle Séance d'Appel" pour commencer.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 overflow-x-auto">
                    {teacherSessions.map(s => (
                      <div key={s.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-slate-900 text-xs sm:text-sm">{s.class_name}</span>
                            <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                              {s.subject_name}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-mono">
                            Date : {new Date(s.attendance_date).toLocaleDateString('fr-FR')} • Créé le {new Date(s.started_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                          <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] ${
                            s.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-100 text-amber-900 border border-amber-200'
                          }`}>
                            {s.status === 'completed' ? 'Finalisée' : 'Brouillon'}
                          </span>

                          <button
                            onClick={() => openAttendanceSheet(s)}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs cursor-pointer transition-colors"
                          >
                            {s.status === 'completed' ? 'Consulter la feuille' : 'Faire l\'appel'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: EMPLOI DU TEMPS RÉEL */}
          {activeTab === 'schedule' && (
            <TeacherTimetableModule
              selectedClassId={selectedClassId}
              onSelectClassId={handleSelectClassId}
              assignedClasses={groupedAssignments.map(g => ({ id: g.class_id, name: g.class_name }))}
            />
          )}

          {/* TAB 5: DEVOIRS */}
          {activeTab === 'homework' && (
            <TeacherHomeworkModule
              assignedClasses={groupedAssignments.map(g => ({ id: g.class_id, name: g.class_name }))}
              assignedSubjects={assignments
                .filter(a => Boolean(a.subject_id))
                .map(a => ({ id: a.subject_id!, name: a.subject_name || 'Matière', class_id: a.class_id }))
              }
              showToast={(msg, type) => showToast(msg, type === 'error' ? 'warning' : type)}
            />
          )}

          {/* TAB 6: NOTES ET ÉVALUATIONS */}
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

          {/* TAB 7: MESSAGES */}
          {activeTab === 'messages' && (
            <SchoolMessagingModule
              mode="teacher"
              assignedClasses={groupedAssignments}
              assignedStudentsMap={classStudentsMap}
            />
          )}

          {/* TAB 8: MON PROFIL */}
          {activeTab === 'profile' && (
            <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
              <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-xs space-y-6">
                <h2 className="text-lg font-extrabold text-slate-900 border-b border-slate-100 pb-3">Profil Enseignant Professionnel</h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Prénom & Nom :</span>
                    <p className="font-extrabold text-slate-900 text-sm">{teacherFullName}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Matricule Employé :</span>
                    <p className="font-mono text-amber-700 font-bold text-sm">{teacherRecord?.employee_number || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Statut du Compte :</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[10px] inline-block">
                      Actif ({teacherRecord?.employment_status || 'Titulaire'})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-bold block mb-1">Spécialité :</span>
                    <p className="font-bold text-slate-800">{teacherRecord?.specialty || 'Non renseignée'}</p>
                  </div>
                </div>

                {/* Formulaire de mise à jour Téléphone */}
                <form onSubmit={handleUpdatePhone} className="pt-4 border-t border-slate-100 space-y-3">
                  <label className="block text-xs font-bold text-slate-800">
                    Téléphone de contact direct :
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={teacherPhone}
                        onChange={e => setTeacherPhone(e.target.value)}
                        placeholder="+243..."
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={updatingPhone}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {updatingPhone ? 'Mise à jour...' : 'Enregistrer'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Carte Signature Officielle */}
              <TeacherOfficialSignatureCard
                teacherRecord={teacherRecord}
              />
            </div>
          )}
        </main>
      </div>

      {/* MODAL NOUVELLE SÉANCE D'APPEL */}
      {showNewSessionModal && (
        <Modal
          isOpen={showNewSessionModal}
          onClose={() => setShowNewSessionModal(false)}
          title="Créer une Nouvelle Séance d'Appel"
        >
          <form onSubmit={handleCreateSession} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Classe : *</label>
              <select
                value={newSessionClassId}
                onChange={e => setNewSessionClassId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold focus:outline-none focus:border-amber-500"
                required
              >
                <option value="">-- Sélectionner une classe --</option>
                {groupedAssignments.map(g => (
                  <option key={g.class_id} value={g.class_id}>{g.class_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Matière / Type d'appel :</label>
              <select
                value={newSessionSubjectId}
                onChange={e => setNewSessionSubjectId(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="">Appel Général (Titularisation)</option>
                {subjectsList.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date de la séance : *</label>
              <input
                type="date"
                value={newSessionDate}
                onChange={e => setNewSessionDate(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewSessionModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={creatingSession}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black rounded-xl disabled:opacity-50"
              >
                {creatingSession ? 'Création...' : 'Commencer l\'appel'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL FEUILLE D'APPEL COMPLÈTE */}
      {showTakeAttendanceModal && selectedSession && (
        <Modal
          isOpen={showTakeAttendanceModal}
          onClose={() => setShowTakeAttendanceModal(false)}
          title={`Feuille d'Appel — ${selectedSession.class_name} (${selectedSession.subject_name})`}
          maxWidth="4xl"
        >
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 font-medium flex items-center justify-between">
              <span>Date : <strong>{new Date(selectedSession.attendance_date).toLocaleDateString('fr-FR')}</strong></span>
              <span>Statut actuel : <strong>{selectedSession.status === 'completed' ? 'Finalisée' : 'Brouillon'}</strong></span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto pr-1">
              {sheetRecords.map((rec, idx) => (
                <div key={rec.student.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900 text-xs">
                      {rec.student.first_name} {rec.student.last_name}
                    </p>
                    <span className="text-[10px] font-mono text-slate-400">
                      N° {rec.student.student_number || 'N/A'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...sheetRecords];
                        updated[idx].status = 'present';
                        setSheetRecords(updated);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                        rec.status === 'present' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Présent
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...sheetRecords];
                        updated[idx].status = 'absent';
                        setSheetRecords(updated);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                        rec.status === 'absent' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Absent
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...sheetRecords];
                        updated[idx].status = 'late';
                        setSheetRecords(updated);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                        rec.status === 'late' ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      En retard
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...sheetRecords];
                        updated[idx].status = 'excused';
                        setSheetRecords(updated);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer transition-colors ${
                        rec.status === 'excused' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Excusé
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowTakeAttendanceModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Fermer
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingAttendance}
                  onClick={() => handleSaveAttendanceSheet(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl disabled:opacity-50"
                >
                  {savingAttendance ? 'Enregistrement...' : 'Enregistrer Brouillon'}
                </button>
                <button
                  type="button"
                  disabled={savingAttendance}
                  onClick={() => handleSaveAttendanceSheet(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold rounded-xl disabled:opacity-50"
                >
                  {savingAttendance ? 'Clôture...' : 'Finaliser la séance'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL ROSTER ÉLÈVES DE CLASSE */}
      {showClassStudentsModal && selectedClassForRoster && (
        <Modal
          isOpen={showClassStudentsModal}
          onClose={() => setShowClassStudentsModal(false)}
          title={`Élèves inscrits — ${selectedClassForRoster.name}`}
          maxWidth="2xl"
        >
          <div className="space-y-4">
            {(() => {
              const students = classStudentsMap[selectedClassForRoster.id] || [];
              if (students.length === 0) {
                return (
                  <p className="text-xs text-slate-500 text-center py-6">
                    Aucun élève inscrit trouvé pour cette classe.
                  </p>
                );
              }

              return (
                <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
                  {students.map((st, i) => (
                    <div key={st.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 text-center font-mono text-slate-400 text-[10px]">{i + 1}.</span>
                        <span className="font-bold text-slate-900">{st.first_name} {st.last_name}</span>
                      </div>
                      <span className="font-mono text-slate-500 text-[11px]">N° {st.student_number || 'N/A'}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* MODALS DEVOIRS */}
      {/* 1. CRÉATION DEVOIR */}
      {showCreateHwModal && (
        <Modal
          isOpen={showCreateHwModal}
          onClose={() => setShowCreateHwModal(false)}
          title="Créer un Nouveau Devoir"
          maxWidth="2xl"
        >
          <form onSubmit={handleCreateHomework} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Classe : *</label>
                <select
                  value={hwClassId}
                  onChange={e => setHwClassId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold focus:outline-none focus:border-amber-500"
                  required
                >
                  <option value="">-- Sélectionner une classe --</option>
                  {groupedAssignments.map(g => (
                    <option key={g.class_id} value={g.class_id}>{g.class_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Matière : *</label>
                <select
                  value={hwSubjectId}
                  onChange={e => setHwSubjectId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                  required
                >
                  <option value="">-- Sélectionner une matière --</option>
                  {subjectsList.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Titre du devoir : *</label>
              <input
                type="text"
                value={hwTitle}
                onChange={e => setHwTitle(e.target.value)}
                placeholder="Ex: Exercices de Mathématiques Chapitre 3"
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Consignes et instructions : *</label>
              <textarea
                value={hwInstructions}
                onChange={e => setHwInstructions(e.target.value)}
                rows={4}
                placeholder="Détaillez le travail à effectuer..."
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Date d'échéance : *</label>
                <input
                  type="date"
                  value={homeworkDueDate}
                  onChange={e => setHomeworkDueDate(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Heure d'échéance : *</label>
                <input
                  type="time"
                  value={homeworkDueTime}
                  onChange={e => setHomeworkDueTime(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Durée estimée (min) :</label>
                <input
                  type="number"
                  value={hwEstimatedMinutes}
                  onChange={e => setHwEstimatedMinutes(e.target.value)}
                  placeholder="30"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="hwPublishNow"
                checked={hwPublishNow}
                onChange={e => setHwPublishNow(e.target.checked)}
                className="w-4 h-4 text-amber-500 rounded focus:ring-amber-500"
              />
              <label htmlFor="hwPublishNow" className="text-xs font-bold text-slate-800 cursor-pointer">
                Publier immédiatement pour les parents et élèves
              </label>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateHwModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingHw}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black rounded-xl disabled:opacity-50"
              >
                {submittingHw ? 'Enregistrement...' : hwPublishNow ? 'Publier le devoir' : 'Enregistrer en brouillon'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* 2. DÉTAILS DEVOIR */}
      {showDetailHwModal && selectedHw && (
        <Modal
          isOpen={showDetailHwModal}
          onClose={() => setShowDetailHwModal(false)}
          title={`Devoir : ${selectedHw.title}`}
          maxWidth="2xl"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-bold text-slate-900">{selectedHw.class_name}</span> • <span className="text-amber-800 font-bold">{selectedHw.subject_name}</span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-900 border border-amber-200">
                Statut : {selectedHw.status}
              </span>
            </div>

            <div>
              <span className="text-slate-500 font-bold block mb-1">Instructions :</span>
              <p className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 whitespace-pre-wrap leading-relaxed">
                {selectedHw.instructions}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
              <div>
                <span className="text-slate-500 block">Date d'assignation :</span>
                <span className="font-bold text-slate-900">{new Date(selectedHw.assigned_on).toLocaleDateString('fr-FR')}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Échéance :</span>
                <span className="font-bold text-amber-800">
                  {new Date(selectedHw.due_at).toLocaleDateString('fr-FR')} à {new Date(selectedHw.due_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-between items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDetailHwModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Fermer
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditHwModal(selectedHw)}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
                >
                  Modifier
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 3. MODIFIER DEVOIR */}
      {showEditHwModal && selectedHw && (
        <Modal
          isOpen={showEditHwModal}
          onClose={() => setShowEditHwModal(false)}
          title={`Modifier le Devoir — ${selectedHw.title}`}
          maxWidth="2xl"
        >
          <form onSubmit={handleUpdateHomework} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Titre du devoir : *</label>
              <input
                type="text"
                value={hwTitle}
                onChange={e => setHwTitle(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Consignes et instructions : *</label>
              <textarea
                value={hwInstructions}
                onChange={e => setHwInstructions(e.target.value)}
                rows={4}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Date d'échéance : *</label>
                <input
                  type="date"
                  value={homeworkDueDate}
                  onChange={e => setHomeworkDueDate(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Heure d'échéance : *</label>
                <input
                  type="time"
                  value={homeworkDueTime}
                  onChange={e => setHomeworkDueTime(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
            </div>

            {selectedHw.status === 'published' && (
              <div>
                <label className="block text-xs font-bold text-amber-800 mb-1">
                  Motif de la modification (Devoir déjà publié) : *
                </label>
                <input
                  type="text"
                  value={actionReason}
                  onChange={e => setActionReason(e.target.value)}
                  placeholder="Ex: Rectification des consignes sur l'exercice 2"
                  className="w-full p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-slate-900 font-medium focus:outline-none"
                  required
                />
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEditHwModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingAction}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black rounded-xl disabled:opacity-50"
              >
                {submittingAction ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* 4. ANNULER DEVOIR */}
      {showCancelHwModal && selectedHw && (
        <Modal
          isOpen={showCancelHwModal}
          onClose={() => setShowCancelHwModal(false)}
          title={`Annuler le Devoir — ${selectedHw.title}`}
        >
          <form onSubmit={handleCancelHomework} className="space-y-4">
            <p className="text-xs text-slate-600">
              Êtes-vous sûr de vouloir annuler ce devoir ? Un motif explicite est requis.
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Motif d'annulation : *</label>
              <input
                type="text"
                value={actionReason}
                onChange={e => setActionReason(e.target.value)}
                placeholder="Ex: Report au cours suivant..."
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium"
                required
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelHwModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Fermer
              </button>
              <button
                type="submit"
                disabled={submittingAction}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold rounded-xl disabled:opacity-50"
              >
                {submittingAction ? 'Annulation...' : 'Confirmer l\'annulation'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
