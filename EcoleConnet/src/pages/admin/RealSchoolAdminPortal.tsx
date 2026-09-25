import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { supabase } from '../../lib/supabase';
import { Logo } from '../../components/common/Logo';
import { Modal } from '../../components/common/Modal';
import {
  Calendar,
  Layers,
  BookOpen,
  UserCheck,
  GraduationCap,
  Settings,
  Plus,
  CheckCircle2,
  Clock,
  Activity,
  Upload,
  Download,
  LogOut,
  BookMarked,
  AlertCircle,
  ArrowRightLeft,
  Filter,
  UserX,
  Users,
  CalendarCheck,
  RotateCcw,
  FileText,
  FileCheck,
  XCircle,
  Award,
  Mail,
  Send,
  UserPlus,
  Phone,
  Lock,
  Unlock,
  CalendarDays,
  Sliders,
  DollarSign,
  Eye,
  Edit3,
  Info
} from 'lucide-react';
import { AdminGradesModule } from '../../components/admin/AdminGradesModule';
import { ClassSubjectCoefficientsModule } from '../../components/admin/ClassSubjectCoefficientsModule';
import { SchoolOfficialIdentityModule } from '../../components/admin/SchoolOfficialIdentityModule';
import { FinanceDashboardModule } from '../../components/admin/finance/FinanceDashboardModule';
import { StudentDossierModal } from '../../components/modals/StudentDossierModal';
import { TeacherDossierModal } from '../../components/modals/TeacherDossierModal';
import { SchoolTimetableManagement } from '../../components/admin/SchoolTimetableManagement';
import { AdminSchoolDocumentsModule } from '../../components/admin/AdminSchoolDocumentsModule';

interface SubjectRow {
  id: string;
  school_id: string;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface TeacherRow {
  id: string;
  school_id: string;
  profile_id: string | null;
  employee_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  gender: 'M' | 'F' | null;
  speciality: string | null;
  employment_status: 'active' | 'on_leave' | 'terminated';
  account_status: 'not_invited' | 'invited' | 'active' | 'suspended';
  created_at: string;
}

interface StudentRow {
  id: string;
  school_id: string;
  profile_id: string | null;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  gender: 'M' | 'F' | null;
  class_id: string | null;
  guardian_reference: string | null;
  account_status: string;
  email?: string | null;
  phone?: string | null;
  created_at: string;
}

export interface LinkedStudentInfo {
  link_id: string;
  student_id: string;
  student_number: string;
  first_name: string | null;
  last_name: string | null;
  relationship: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  can_view_academic: boolean;
  can_view_attendance: boolean;
  can_view_homework: boolean;
  can_view_finances: boolean;
  can_receive_notifications: boolean;
  can_pickup_student: boolean;
  class_name?: string;
}

export interface ParentRow {
  parent_profile_id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  linked_students: LinkedStudentInfo[];
}

interface StudentEnrollmentRow {
  id: string;
  school_id: string;
  student_id: string;
  academic_year_id: string;
  class_id: string;
  status: 'active' | 'transferred' | 'graduated' | 'withdrawn' | 'suspended';
  enrolled_on: string;
  ended_on: string | null;
  created_at: string;
}

interface AttendanceSessionRow {
  id: string;
  school_id: string;
  class_id: string;
  academic_year_id: string;
  term_id: string | null;
  subject_id: string | null;
  teacher_id: string | null;
  attendance_date: string;
  started_at: string;
  completed_at: string | null;
  status: 'draft' | 'completed' | 'reopened' | 'cancelled';
  notes: string | null;
  reopen_reason: string | null;
  created_by: string;
  created_at: string;
}

interface StudentAttendanceRow {
  id: string;
  school_id: string;
  attendance_session_id: string;
  student_id: string;
  enrollment_id: string;
  status: 'present' | 'absent' | 'late' | 'excused' | 'left_early';
  arrival_time: string | null;
  departure_time: string | null;
  justification: string | null;
  justified: boolean;
  marked_by: string;
  marked_at: string;
  updated_at: string;
}

interface ClassRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  name: string;
  level: string | null;
  section: string | null;
  room: string | null;
  education_cycle: 'primary' | 'secondary' | null;
  pedagogical_mode?: 'primary_homeroom' | 'secondary_subjects' | null;
  homeroom_teacher_id: string | null;
  is_active: boolean;
  created_at: string;
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
  education_cycle: 'primary' | 'secondary' | null;
  division_type: 'trimester' | 'semester' | null;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
}

interface SchoolPeriodRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  parent_term_id: string;
  education_cycle: 'primary' | 'secondary';
  name: string;
  position: number;
  position_within_parent: number;
  starts_on: string | null;
  ends_on: string | null;
  is_active: boolean;
  created_at: string;
}

interface AssignmentRow {
  id: string;
  school_id: string;
  teacher_id: string | null;
  teacher_profile_id: string;
  class_id: string;
  subject_id: string | null;
  subject_name: string;
  academic_year_id: string;
  term_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface ImportJobRow {
  id: string;
  school_id: string;
  import_type: 'teachers' | 'students' | 'classes';
  file_name: string | null;
  status: 'validating' | 'ready' | 'processing' | 'completed' | 'failed' | 'cancelled';
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_at: string;
}

interface HomeworkAdminRow {
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

type SchoolAdminTab =
  | 'vue_densemble'
  | 'finance'
  | 'annees_scolaires'
  | 'trimestres'
  | 'matieres'
  | 'coefficients'
  | 'classes'
  | 'enseignants'
  | 'parents'
  | 'eleves'
  | 'presences'
  | 'devoirs'
  | 'emploi_du_temps'
  | 'notes'
  | 'affectations'
  | 'importations'
  | 'documents'
  | 'parametres';

export const RealSchoolAdminPortal: React.FC = () => {
  const { profile, school, signOutReal } = useRealAuth();
  const { showToast } = useNotifications();

  const isFinanceAgent = profile?.role === 'finance_agent';

  // Active Tab State (finance_agent defaults and is locked to 'finance')
  const [activeTab, setActiveTab] = useState<SchoolAdminTab>(() =>
    profile?.role === 'finance_agent' ? 'finance' : 'vue_densemble'
  );

  useEffect(() => {
    if (isFinanceAgent && activeTab !== 'finance') {
      setActiveTab('finance');
    }
  }, [isFinanceAgent, activeTab]);

  // Horizontal Navigation Scroll Refs & Indicators
  const navRef = useRef<HTMLElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollIndicators = useCallback(() => {
    const container = navRef.current;
    if (container) {
      const { scrollLeft, scrollWidth, clientWidth } = container;
      setCanScrollLeft(scrollLeft > 4);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
    }
  }, []);

  useEffect(() => {
    const container = navRef.current;
    if (container) {
      updateScrollIndicators();
      container.addEventListener('scroll', updateScrollIndicators, { passive: true });
      window.addEventListener('resize', updateScrollIndicators);
      return () => {
        container.removeEventListener('scroll', updateScrollIndicators);
        window.removeEventListener('resize', updateScrollIndicators);
      };
    }
  }, [updateScrollIndicators]);

  // Auto-scroll active tab into visible area
  useEffect(() => {
    const container = navRef.current;
    const activeEl = activeTabRef.current;
    if (container && activeEl) {
      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();

      if (activeRect.left < containerRect.left) {
        container.scrollTo({
          left: container.scrollLeft + (activeRect.left - containerRect.left) - 16,
          behavior: 'smooth'
        });
      } else if (activeRect.right > containerRect.right) {
        container.scrollTo({
          left: container.scrollLeft + (activeRect.right - containerRect.right) + 16,
          behavior: 'smooth'
        });
      }
    }
    updateScrollIndicators();
  }, [activeTab, updateScrollIndicators]);

  const handleNavWheel = (e: React.WheelEvent<HTMLElement>) => {
    if (navRef.current && e.deltaY !== 0) {
      navRef.current.scrollLeft += e.deltaY;
    }
  };

  const [loading, setLoading] = useState<boolean>(true);
  const [adminAssessmentsCount, setAdminAssessmentsCount] = useState<number>(0);

  // Real Supabase Data States (Scope locked strictly to school.id)
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [schoolTerms, setSchoolTerms] = useState<SchoolTermRow[]>([]);
  const [schoolPeriods, setSchoolPeriods] = useState<SchoolPeriodRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [enrollments, setEnrollments] = useState<StudentEnrollmentRow[]>([]);
  const [attendanceSessions, setAttendanceSessions] = useState<AttendanceSessionRow[]>([]);
  const [studentAttendanceRecords, setStudentAttendanceRecords] = useState<StudentAttendanceRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJobRow[]>([]);
  const [selectedClassFilterId, setSelectedClassFilterId] = useState<string | null>(null);

  // Homework Supervision States
  const [adminHomeworkList, setAdminHomeworkList] = useState<HomeworkAdminRow[]>([]);
  const [adminHwTeacherFilter, setAdminHwTeacherFilter] = useState<string>('all');
  const [adminHwClassFilter, setAdminHwClassFilter] = useState<string>('all');
  const [adminHwSubjectFilter, setAdminHwSubjectFilter] = useState<string>('all');
  const [adminHwStatusFilter, setAdminHwStatusFilter] = useState<string>('all');
  const [selectedAdminHw, setSelectedAdminHw] = useState<HomeworkAdminRow | null>(null);
  const [showAdminHwDetailModal, setShowAdminHwDetailModal] = useState<boolean>(false);
  const [showAdminHwCancelModal, setShowAdminHwCancelModal] = useState<boolean>(false);
  const [adminCancelReason, setAdminCancelReason] = useState<string>('');
  const [submittingAdminCancel, setSubmittingAdminCancel] = useState<boolean>(false);

  // Modals state for Attendance
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [showTakeAttendanceModal, setShowTakeAttendanceModal] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState<AttendanceSessionRow | null>(null);

  // Form States - New Session
  const [newSessionClassId, setNewSessionClassId] = useState('');
  const [newSessionSubjectId, setNewSessionSubjectId] = useState('');
  const [newSessionDate, setNewSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [creatingSession, setCreatingSession] = useState(false);

  // Attendance Sheet Temp Editing State (Keyed by student_id)
  const [sheetRecords, setSheetRecords] = useState<Array<{
    student: StudentRow;
    enrollment_id: string;
    status: 'present' | 'absent' | 'late' | 'excused' | 'left_early';
    arrival_time: string;
    justification: string;
    justified: boolean;
  }>>([]);
  const [savingAttendance, setSavingAttendance] = useState(false);

  // Reopen Modal State
  const [reopenReasonText, setReopenReasonText] = useState('');
  const [reopeningSession, setReopeningSession] = useState(false);

  // Individual Correction Modal State (For Completed Sessions)
  const [showIndividualCorrectionModal, setShowIndividualCorrectionModal] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState<{
    student: StudentRow;
    enrollment_id: string;
    oldStatus: 'present' | 'absent' | 'late' | 'excused' | 'left_early';
    newStatus: 'present' | 'absent' | 'late' | 'excused' | 'left_early';
    arrivalTime: string;
    justification: string;
  } | null>(null);
  const [correctionReasonText, setCorrectionReasonText] = useState('');
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  // Modals state
  const [showYearModal, setShowYearModal] = useState(false);
  const [showTermModal, setShowTermModal] = useState(false);
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);
  const [showTeacherModal, setShowTeacherModal] = useState(false);
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showChangeClassModal, setShowChangeClassModal] = useState(false);
  const [selectedStudentForClassChange, setSelectedStudentForClassChange] = useState<StudentRow | null>(null);
  const [targetClassIdForChange, setTargetClassIdForChange] = useState<string>('');
  const [changingClass, setChangingClass] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importType, setImportType] = useState<'teachers' | 'students' | 'classes'>('teachers');

  // Dossiers Modals State
  const [showStudentDossierModal, setShowStudentDossierModal] = useState(false);
  const [selectedStudentForDossier, setSelectedStudentForDossier] = useState<string | null>(null);
  const [showTeacherDossierModal, setShowTeacherDossierModal] = useState(false);
  const [selectedTeacherForDossier, setSelectedTeacherForDossier] = useState<string | null>(null);
  const [dossierInitialMode, setDossierInitialMode] = useState<'view' | 'edit'>('view');

  // Form States - Academic Year
  const [yearName, setYearName] = useState('2026–2027');
  const [yearStartsOn, setYearStartsOn] = useState('2026-09-01');
  const [yearEndsOn, setYearEndsOn] = useState('2027-07-02');
  const [yearIsCurrent, setYearIsCurrent] = useState(true);

  // Form States - School Term
  const [termName, setTermName] = useState('1er Trimestre');
  const [termPosition, setTermPosition] = useState(1);
  const [termYearId, setTermYearId] = useState('');
  const [termStartsOn, setTermStartsOn] = useState('');
  const [termEndsOn, setTermEndsOn] = useState('');

  // Form States - Subject
  const [subjectCode, setSubjectCode] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [subjectDesc, setSubjectDesc] = useState('');

  // Form States - Class
  const [className, setClassName] = useState('');
  const [classLevel, setClassLevel] = useState('7ème EB');
  const [classSection, setClassSection] = useState('A');
  const [classRoom, setClassRoom] = useState('S101');
  const [classYearId, setClassYearId] = useState('');
  const [classTeacherId, setClassTeacherId] = useState('');
  const [classCycle, setClassCycle] = useState<'primary' | 'secondary' | ''>('');

  // Class Cycle Modal States
  const [showSetCycleModal, setShowSetCycleModal] = useState(false);
  const [selectedClassForCycle, setSelectedClassForCycle] = useState<ClassRow | null>(null);
  const [targetCycleForChange, setTargetCycleForChange] = useState<'primary' | 'secondary' | ''>('');
  const [settingCycle, setSettingCycle] = useState(false);

  // Homeroom Teacher Management Modal States
  const [showHomeroomModal, setShowHomeroomModal] = useState<boolean>(false);
  const [selectedClassForHomeroom, setSelectedClassForHomeroom] = useState<ClassRow | null>(null);
  const [selectedTeacherIdForHomeroom, setSelectedTeacherIdForHomeroom] = useState<string>('');
  const [savingHomeroom, setSavingHomeroom] = useState<boolean>(false);
  const [showConfirmRemoveHomeroom, setShowConfirmRemoveHomeroom] = useState<boolean>(false);
  const [showConfirmReplaceHomeroom, setShowConfirmReplaceHomeroom] = useState<boolean>(false);
  const [pendingPrimaryReplace, setPendingPrimaryReplace] = useState<{
    classId: string;
    teacherId: string;
    className: string;
    newTeacherName: string;
  } | null>(null);

  // Pedagogical Mode Management States
  const [classPedagogicalMode, setClassPedagogicalMode] = useState<'primary_homeroom' | 'secondary_subjects'>('secondary_subjects');
  const [showPedagogicalModeModal, setShowPedagogicalModeModal] = useState<boolean>(false);
  const [selectedClassForMode, setSelectedClassForMode] = useState<ClassRow | null>(null);
  const [targetPedagogicalMode, setTargetPedagogicalMode] = useState<'primary_homeroom' | 'secondary_subjects'>('secondary_subjects');
  const [savingPedagogicalMode, setSavingPedagogicalMode] = useState<boolean>(false);


  // DRC Calendar Configuration States
  const [showDrcConfigModal, setShowDrcConfigModal] = useState(false);
  const [drcConfigCycle, setDrcConfigCycle] = useState<'primary' | 'secondary'>('primary');
  const [drcAdoptLegacy, setDrcAdoptLegacy] = useState(false);
  const [configuringDrc, setConfiguringDrc] = useState(false);

  // School Calendars Status & Dates Management
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

  const [showCloseCalendarModal, setShowCloseCalendarModal] = useState(false);
  const [closeCalendarCycle, setCloseCalendarCycle] = useState<'primary' | 'secondary'>('secondary');
  const [closingCalendar, setClosingCalendar] = useState(false);

  // Form States - Teacher
  const [tEmpNumber, setTEmpNumber] = useState('');
  const [tFirstName, setTFirstName] = useState('');
  const [tLastName, setTLastName] = useState('');
  const [tEmail, setTEmail] = useState('');
  const [tPhone, setTPhone] = useState('');
  const [tGender, setTGender] = useState<'M' | 'F'>('M');
  const [tSpeciality, setTSpeciality] = useState('Mathématiques');

  // Form States - Parent
  const [showParentModal, setShowParentModal] = useState(false);
  const [showEditLinkModal, setShowEditLinkModal] = useState(false);
  const [selectedLinkToEdit, setSelectedLinkToEdit] = useState<LinkedStudentInfo | null>(null);
  const [selectedParentForLink, setSelectedParentForLink] = useState<ParentRow | null>(null);
  const [pFirstName, setPFirstName] = useState('');
  const [pLastName, setPLastName] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pRelationship, setPRelationship] = useState('Père');
  const [pStudentIds, setPStudentIds] = useState<string[]>([]);
  const [pCanAcademic, setPCanAcademic] = useState(true);
  const [pCanAttendance, setPCanAttendance] = useState(true);
  const [pCanHomework, setPCanHomework] = useState(true);
  const [pCanFinances, setPCanFinances] = useState(true);
  const [pCanNotifications, setPCanNotifications] = useState(true);
  const [pCanPickup, setPCanPickup] = useState(false);
  const [invitingParent, setInvitingParent] = useState(false);
  const [togglingParentId, setTogglingParentId] = useState<string | null>(null);

  // Form States - Student
  const [sNumber, setSNumber] = useState('');
  const [sFirstName, setSFirstName] = useState('');
  const [sLastName, setSLastName] = useState('');
  const [sMiddleName, setSMiddleName] = useState('');
  const [sBirthDate, setSBirthDate] = useState('2012-05-15');
  const [sBirthPlace, setSBirthPlace] = useState('Kinshasa');
  const [sGender, setSGender] = useState<'M' | 'F'>('M');
  const [sClassId, setSClassId] = useState('');
  const [sGuardianRef, setSGuardianRef] = useState('');

  // Student Invite Modal States
  const [showStudentInviteModal, setShowStudentInviteModal] = useState(false);
  const [selectedStudentForInvite, setSelectedStudentForInvite] = useState<StudentRow | null>(null);
  const [studentInviteEmail, setStudentInviteEmail] = useState('');
  const [invitingStudentId, setInvitingStudentId] = useState<string | null>(null);
  const [togglingStudentId, setTogglingStudentId] = useState<string | null>(null);

  // Form States - Assignment
  const [assignTeacherId, setAssignTeacherId] = useState('');
  const [assignSubjectId, setAssignSubjectId] = useState('');
  const [assignClassId, setAssignClassId] = useState('');

  // Import CSV Preview States
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewRows, setImportPreviewRows] = useState<any[]>([]);
  const [importValidationErrors, setImportValidationErrors] = useState<string[]>([]);
  const [isProcessingImport, setIsProcessingImport] = useState(false);

  // Fetch All School Data (Locked strictly to current school_id)
  const loadSchoolPortalData = useCallback(async () => {
    if (!school?.id) return;
    if (profile?.role === 'finance_agent') {
      setLoading(false);
      return;
    }
    setLoading(true);

    try {
      // 1. Academic Years
      const { data: years } = await supabase
        .from('academic_years')
        .select('*')
        .eq('school_id', school.id)
        .order('starts_on', { ascending: false });
      setAcademicYears(years || []);
      if (years && years.length > 0) {
        setTermYearId(years[0].id);
        setClassYearId(years[0].id);
      }

      // 2. School Terms
      const { data: terms } = await supabase
        .from('school_terms')
        .select('*')
        .eq('school_id', school.id)
        .order('position', { ascending: true });
      setSchoolTerms(terms || []);

      // 3. Subjects
      const { data: subj } = await supabase
        .from('subjects')
        .select('*')
        .eq('school_id', school.id)
        .order('name', { ascending: true });
      setSubjects(subj || []);

      // 4. Classes
      const { data: cls } = await supabase
        .from('classes')
        .select('*')
        .eq('school_id', school.id)
        .order('name', { ascending: true });
      setClasses(cls || []);
      if (cls && cls.length > 0) {
        setSClassId(cls[0].id);
        setAssignClassId(cls[0].id);
      }

      // 5. Teachers
      const { data: tch } = await supabase
        .from('teachers')
        .select('*')
        .eq('school_id', school.id)
        .order('last_name', { ascending: true });
      setTeachers(tch || []);
      if (tch && tch.length > 0) {
        setAssignTeacherId(tch[0].id);
      }

      // 6. Students
      const { data: std } = await supabase
        .from('students')
        .select('*')
        .eq('school_id', school.id)
        .order('last_name', { ascending: true });
      setStudents(std || []);

      // 7. Student Enrollments
      const { data: enr } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('school_id', school.id);
      setEnrollments(enr || []);

      // 8. Teacher Assignments
      const { data: assg } = await supabase
        .from('teacher_class_assignments')
        .select('*')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false });
      setAssignments(assg || []);

      // 9. Import Jobs
      const { data: jobs } = await supabase
        .from('school_import_jobs')
        .select('*')
        .eq('school_id', school.id)
        .order('created_at', { ascending: false });
      setImportJobs(jobs || []);

      // 10. Attendance Sessions
      const { data: sessData } = await supabase
        .from('attendance_sessions')
        .select('*')
        .eq('school_id', school.id)
        .order('attendance_date', { ascending: false });
      setAttendanceSessions(sessData || []);

      // 11. Student Attendance Records
      const { data: attData } = await supabase
        .from('student_attendance')
        .select('*')
        .eq('school_id', school.id);
      setStudentAttendanceRecords(attData || []);

      // 12. Devoirs pour supervision de l'administration
      const { data: hwData } = await supabase.rpc('get_teacher_homework');
      setAdminHomeworkList((hwData || []) as HomeworkAdminRow[]);

      // 13. Périodes Scolaires RDC
      const { data: periodsData } = await supabase
        .from('school_periods')
        .select('*')
        .eq('school_id', school.id)
        .order('position', { ascending: true });
      setSchoolPeriods(periodsData || []);

      // 13b. Calendriers Scolaires Datés
      const { data: calendarsData } = await supabase
        .from('school_calendars')
        .select('*')
        .eq('school_id', school.id);
      setSchoolCalendars(calendarsData || []);

      // 14. Parents & Responsables Légaux
      const { data: parentsData, error: parentsErr } = await supabase.rpc('get_school_parents');
      if (!parentsErr && parentsData) {
        setParents(parentsData as ParentRow[]);
      } else {
        setParents([]);
      }

    } catch (err: any) {
      console.error('Error loading school admin portal data:', err);
      showToast(err.message || 'Erreur lors du chargement des données de l’établissement.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [school?.id, profile?.role]);

  // Handler - Annulation administrative de devoir avec motif
  const handleAdminCancelHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdminHw) return;
    if (!adminCancelReason.trim()) {
      showToast('Un motif explicite est obligatoire pour annuler un devoir administrativement.', 'warning');
      return;
    }

    setSubmittingAdminCancel(true);
    try {
      const { error } = await supabase.rpc('cancel_teacher_homework', {
        p_homework_id: selectedAdminHw.id,
        p_reason: adminCancelReason.trim()
      });

      if (error) throw error;

      showToast('Devoir annulé administrativement avec succès. Action enregistrée dans le journal d’audit.', 'success');
      setShowAdminHwCancelModal(false);
      if (showAdminHwDetailModal) setShowAdminHwDetailModal(false);
      setAdminCancelReason('');
      await loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’annulation administrative du devoir.', 'warning');
    } finally {
      setSubmittingAdminCancel(false);
    }
  };

  useEffect(() => {
    if (profile?.role !== 'finance_agent') {
      loadSchoolPortalData();
    } else {
      setLoading(false);
    }
  }, [loadSchoolPortalData, profile?.role]);

  // Handlers - Academic Year
  const handleCreateYear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id) return;
    try {
      if (yearIsCurrent) {
        await supabase
          .from('academic_years')
          .update({ is_current: false })
          .eq('school_id', school.id);
      }
      const { error } = await supabase.from('academic_years').insert({
        school_id: school.id,
        name: yearName.trim(),
        starts_on: yearStartsOn,
        ends_on: yearEndsOn,
        is_current: yearIsCurrent
      });
      if (error) throw error;
      showToast(`Année scolaire "${yearName}" créée avec succès !`, 'success');
      setShowYearModal(false);
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de l’année scolaire.', 'warning');
    }
  };

  // Handlers - School Term
  const handleCreateTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !termYearId) return;
    try {
      const { error } = await supabase.from('school_terms').insert({
        school_id: school.id,
        academic_year_id: termYearId,
        name: termName.trim(),
        position: termPosition,
        starts_on: termStartsOn || null,
        ends_on: termEndsOn || null
      });
      if (error) throw error;
      showToast(`Trimestre "${termName}" enregistré avec succès !`, 'success');
      setShowTermModal(false);
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création du trimestre.', 'warning');
    }
  };

  // Handlers - Subject
  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !subjectName.trim()) return;
    try {
      const { error } = await supabase.from('subjects').insert({
        school_id: school.id,
        code: subjectCode.trim() || null,
        name: subjectName.trim(),
        description: subjectDesc.trim() || null,
        is_active: true
      });
      if (error) throw error;
      showToast(`Matière "${subjectName}" créée avec succès !`, 'success');
      setShowSubjectModal(false);
      setSubjectCode('');
      setSubjectName('');
      setSubjectDesc('');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de la matière.', 'warning');
    }
  };

  // Insert suggested preset subjects
  const handleAddPresetSubjects = async (presetName: string, presetCode: string) => {
    if (!school?.id) return;
    try {
      const { error } = await supabase.from('subjects').insert({
        school_id: school.id,
        code: presetCode,
        name: presetName,
        is_active: true
      });
      if (error) throw error;
      showToast(`Matière suggérée "${presetName}" ajoutée !`, 'info');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(`Matière "${presetName}" déjà présente ou erreur.`, 'warning');
    }
  };

  // Handlers - Class
  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !className.trim() || !classYearId) return;
    try {
      const { error } = await supabase.from('classes').insert({
        school_id: school.id,
        academic_year_id: classYearId,
        name: className.trim(),
        level: classLevel,
        section: classSection,
        room: classRoom,
        education_cycle: classCycle || null,
        pedagogical_mode: classPedagogicalMode || 'secondary_subjects',
        homeroom_teacher_id: null,
        is_active: true
      });
      if (error) throw error;
      showToast(`Classe "${className}" créée avec succès !`, 'success');
      setShowClassModal(false);
      setClassName('');
      setClassCycle('');
      setClassPedagogicalMode('secondary_subjects');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de la classe.', 'warning');
    }
  };

  // Handler - Set / Update Class Pedagogical Mode via RPC
  const handleSetPedagogicalMode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassForMode) return;
    setSavingPedagogicalMode(true);
    try {
      const { error } = await supabase.rpc('set_class_pedagogical_mode', {
        p_class_id: selectedClassForMode.id,
        p_pedagogical_mode: targetPedagogicalMode
      });
      if (error) throw error;
      showToast(`Mode pédagogique de la classe "${selectedClassForMode.name}" mis à jour (${targetPedagogicalMode === 'primary_homeroom' ? 'Primaire — Titulaire' : 'Secondaire — Par matière'}).`, 'success');
      setShowPedagogicalModeModal(false);
      setSelectedClassForMode(null);
      await loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la mise à jour du mode pédagogique.', 'warning');
    } finally {
      setSavingPedagogicalMode(false);
    }
  };

  // Handler - Set / Update Class Education Cycle via RPC
  const handleSetClassCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassForCycle) return;
    setSettingCycle(true);
    try {
      const { error } = await supabase.rpc('set_class_education_cycle', {
        p_class_id: selectedClassForCycle.id,
        p_education_cycle: targetCycleForChange || null
      });
      if (error) throw error;
      showToast(`Cycle scolaire de la classe "${selectedClassForCycle.name}" mis à jour avec succès !`, 'success');
      setShowSetCycleModal(false);
      setSelectedClassForCycle(null);
      await loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la mise à jour du cycle de la classe.', 'warning');
    } finally {
      setSettingCycle(false);
    }
  };


  // Handler - Configure DRC Academic Calendar via RPC
  const handleConfigureDrcCalendar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentYearObj) {
      showToast('Veuillez d’abord configurer et activer une année scolaire.', 'warning');
      return;
    }
    setConfiguringDrc(true);
    try {
      const { error } = await supabase.rpc('configure_drc_academic_calendar', {
        p_academic_year_id: currentYearObj.id,
        p_education_cycle: drcConfigCycle,
        p_adopt_legacy_terms: drcAdoptLegacy
      });
      if (error) throw error;
      showToast(`Calendrier Scolaire pour le cycle ${drcConfigCycle === 'primary' ? 'Primaire (3 Trimestres / 9 Périodes)' : 'Secondaire (2 Semestres / 4 Périodes)'} configuré avec succès !`, 'success');
      setShowDrcConfigModal(false);
      await loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la configuration du calendrier scolaire.', 'warning');
    } finally {
      setConfiguringDrc(false);
    }
  };

  // Handler - Affecter un Professeur Titulaire via RPC
  const handleAssignHomeroomTeacher = async () => {
    if (!selectedClassForHomeroom || !selectedTeacherIdForHomeroom) {
      showToast('Veuillez sélectionner un enseignant actif.', 'warning');
      return;
    }

    setSavingHomeroom(true);
    try {
      const { error } = await supabase.rpc('assign_class_homeroom_teacher', {
        p_class_id: selectedClassForHomeroom.id,
        p_teacher_id: selectedTeacherIdForHomeroom,
        p_expected_current_profile_id: selectedClassForHomeroom.homeroom_teacher_id || null
      });

      if (error) throw error;

      showToast(`Professeur titulaire affecté avec succès à la classe ${selectedClassForHomeroom.name}.`, 'success');
      setShowHomeroomModal(false);
      setShowConfirmReplaceHomeroom(false);
      setSelectedClassForHomeroom(null);
      setSelectedTeacherIdForHomeroom('');
      await loadSchoolPortalData();
    } catch (err: any) {
      console.error('[RealSchoolAdminPortal] Erreur affectation titulaire:', err);
      setShowConfirmReplaceHomeroom(false);
      const friendlyMsg = err?.message || 'Erreur lors de l’affectation du professeur titulaire.';
      showToast(friendlyMsg, 'warning');
    } finally {
      setSavingHomeroom(false);
    }
  };

  // Handler - Retirer le Professeur Titulaire via RPC
  const handleRemoveHomeroomTeacher = async () => {
    if (!selectedClassForHomeroom || !selectedClassForHomeroom.homeroom_teacher_id) return;

    setSavingHomeroom(true);
    try {
      const { error } = await supabase.rpc('remove_class_homeroom_teacher', {
        p_class_id: selectedClassForHomeroom.id,
        p_expected_profile_id: selectedClassForHomeroom.homeroom_teacher_id
      });

      if (error) throw error;

      showToast(`Professeur titulaire retiré de la classe ${selectedClassForHomeroom.name}.`, 'success');
      setShowHomeroomModal(false);
      setShowConfirmRemoveHomeroom(false);
      setSelectedClassForHomeroom(null);
      setSelectedTeacherIdForHomeroom('');
      await loadSchoolPortalData();
    } catch (err: any) {
      console.error('[RealSchoolAdminPortal] Erreur retrait titulaire:', err);
      setShowConfirmRemoveHomeroom(false);
      const friendlyMsg = err?.message || 'Erreur lors du retrait du professeur titulaire.';
      showToast(friendlyMsg, 'warning');
    } finally {
      setSavingHomeroom(false);
    }
  };

  // Helper Validation Functions
  const validateTermDateInputs = (startsOn: string, endsOn: string, cycle: string, currentTermId?: string) => {
    if (!startsOn || !endsOn) return null;
    if (startsOn > endsOn) return 'La date de début doit être antérieure ou égale à la date de fin.';
    if (currentYearObj?.starts_on && startsOn < currentYearObj.starts_on) {
      return `La date de début (${startsOn}) ne peut pas être antérieure au début de l'année scolaire (${currentYearObj.starts_on}).`;
    }
    if (currentYearObj?.ends_on && endsOn > currentYearObj.ends_on) {
      return `La date de fin (${endsOn}) ne peut pas dépasser la fin de l'année scolaire (${currentYearObj.ends_on}).`;
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
    if (currentYearObj?.starts_on && startsOn < currentYearObj.starts_on) {
      return `La date de début (${startsOn}) ne peut pas être antérieure au début de l'année scolaire (${currentYearObj.starts_on}).`;
    }
    if (currentYearObj?.ends_on && endsOn > currentYearObj.ends_on) {
      return `La date de fin (${endsOn}) ne peut pas dépasser la fin de l'année scolaire (${currentYearObj.ends_on}).`;
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

  // Handlers - Sauvegarde des dates
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
      await loadSchoolPortalData();
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
      await loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’enregistrement des dates de la période.', 'warning');
    } finally {
      setSavingPeriodDates(false);
    }
  };

  // Handlers - Activation / Réouverture / Clôture du Calendrier
  const handleActivateCalendar = async (cycle: 'primary' | 'secondary') => {
    if (!school?.id || !currentYearObj?.id) return;
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
        p_academic_year_id: currentYearObj.id,
        p_education_cycle: cycle
      });
      if (error) throw error;
      showToast(`Calendrier Scolaire pour le cycle ${cycle === 'primary' ? 'Primaire' : 'Secondaire'} activé avec succès !`, 'success');
      await loadSchoolPortalData();
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
    if (!school?.id || !currentYearObj?.id) return;
    if (reopenReasonInput.trim().length < 5) {
      showToast('Le motif de réouverture doit comporter au moins 5 caractères.', 'warning');
      return;
    }
    setReopeningCalendar(true);
    try {
      const { error } = await supabase.rpc('reopen_school_calendar', {
        p_school_id: school.id,
        p_academic_year_id: currentYearObj.id,
        p_education_cycle: reopenCalendarCycle,
        p_reason: reopenReasonInput.trim()
      });
      if (error) throw error;
      showToast(`Calendrier Scolaire (${reopenCalendarCycle === 'primary' ? 'Primaire' : 'Secondaire'}) rouvert en statut brouillon.`, 'success');
      setShowReopenCalendarModal(false);
      setReopenReasonInput('');
      await loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la réouverture du calendrier.', 'warning');
    } finally {
      setReopeningCalendar(false);
    }
  };

  const handleOpenCloseModal = (cycle: 'primary' | 'secondary') => {
    setCloseCalendarCycle(cycle);
    setShowCloseCalendarModal(true);
  };

  const handleConfirmCloseCalendar = async () => {
    if (!school?.id || !currentYearObj?.id) return;
    setClosingCalendar(true);
    try {
      const { error } = await supabase.rpc('close_school_calendar', {
        p_school_id: school.id,
        p_academic_year_id: currentYearObj.id,
        p_education_cycle: closeCalendarCycle
      });
      if (error) throw error;
      showToast(`Calendrier Scolaire (${closeCalendarCycle === 'primary' ? 'Primaire' : 'Secondaire'}) clôturé.`, 'success');
      setShowCloseCalendarModal(false);
      await loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la clôture du calendrier.', 'warning');
    } finally {
      setClosingCalendar(false);
    }
  };

  // Handlers - Teacher Dossier
  const handleCreateTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !tEmpNumber.trim() || !tFirstName.trim() || !tLastName.trim()) {
      showToast('Le matricule, prénom et nom sont obligatoires.', 'warning');
      return;
    }
    try {
      const { error } = await supabase.from('teachers').insert({
        school_id: school.id,
        employee_number: tEmpNumber.trim(),
        first_name: tFirstName.trim(),
        last_name: tLastName.trim(),
        email: tEmail.trim() || null,
        phone: tPhone.trim() || null,
        gender: tGender,
        speciality: tSpeciality.trim() || null,
        employment_status: 'active',
        account_status: 'not_invited'
      });
      if (error) throw error;
      showToast(`Enseignant "${tFirstName} ${tLastName}" enregistré dans le registre !`, 'success');
      setShowTeacherModal(false);
      setTEmpNumber('');
      setTFirstName('');
      setTLastName('');
      setTEmail('');
      setTPhone('');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du préenregistrement de l’enseignant.', 'warning');
    }
  };

  // Handlers - Student Dossier & Enrollment
  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !sNumber.trim() || !sFirstName.trim() || !sLastName.trim()) {
      showToast('Le matricule, prénom et nom sont obligatoires.', 'warning');
      return;
    }
    try {
      // 1. Insert Student record
      const { data: stdData, error: stdErr } = await supabase
        .from('students')
        .insert({
          school_id: school.id,
          student_number: sNumber.trim(),
          first_name: sFirstName.trim(),
          last_name: sLastName.trim(),
          middle_name: sMiddleName.trim() || null,
          date_of_birth: sBirthDate || null,
          birth_place: sBirthPlace.trim() || null,
          gender: sGender,
          class_id: sClassId || null,
          guardian_reference: sGuardianRef.trim() || null,
          account_status: 'not_invited'
        })
        .select('id')
        .single();

      if (stdErr) throw stdErr;

      // 2. Insert active Enrollment if class & academic year exist
      const activeYear = academicYears.find(y => y.is_current) || academicYears[0];
      if (stdData?.id && sClassId && activeYear) {
        await supabase.from('student_enrollments').insert({
          school_id: school.id,
          student_id: stdData.id,
          academic_year_id: activeYear.id,
          class_id: sClassId,
          status: 'active',
          enrolled_on: new Date().toISOString().split('T')[0]
        });
      }

      showToast(`Élève "${sFirstName} ${sLastName}" enregistré et inscrit avec succès !`, 'success');
      setShowStudentModal(false);
      setSNumber('');
      setSFirstName('');
      setSLastName('');
      setSMiddleName('');
      setSGuardianRef('');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du préenregistrement de l’élève.', 'warning');
    }
  };

  const openChangeClassModal = (student: StudentRow) => {
    setSelectedStudentForClassChange(student);
    const activeEnrollment = enrollments.find(e => e.student_id === student.id && e.status === 'active');
    const currentClassId = activeEnrollment?.class_id || student.class_id || (classes[0]?.id || '');
    setTargetClassIdForChange(currentClassId);
    setShowChangeClassModal(true);
  };

  const handleSaveChangeClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !selectedStudentForClassChange || !targetClassIdForChange) return;

    setChangingClass(true);
    try {
      const targetClass = classes.find(c => c.id === targetClassIdForChange);
      if (!targetClass) throw new Error("La classe sélectionnée est introuvable.");

      // 1. Désactiver l'ancienne inscription active si elle existe
      const activeEnrollment = enrollments.find(
        e => e.student_id === selectedStudentForClassChange.id && e.status === 'active'
      );

      if (activeEnrollment) {
        await supabase
          .from('student_enrollments')
          .update({
            status: 'transferred',
            ended_on: new Date().toISOString().split('T')[0],
            updated_at: new Date().toISOString()
          })
          .eq('id', activeEnrollment.id);
      }

      // 2. Créer la nouvelle inscription active dans la classe cible
      const { error: newEnrErr } = await supabase.from('student_enrollments').insert({
        school_id: school.id,
        student_id: selectedStudentForClassChange.id,
        academic_year_id: targetClass.academic_year_id,
        class_id: targetClass.id,
        status: 'active',
        enrolled_on: new Date().toISOString().split('T')[0]
      });

      if (newEnrErr) throw newEnrErr;

      // 3. Mettre à jour students.class_id pour la cohérence directe
      await supabase
        .from('students')
        .update({
          class_id: targetClass.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedStudentForClassChange.id);

      showToast(`Élève ${selectedStudentForClassChange.first_name} ${selectedStudentForClassChange.last_name} affecté à la classe "${targetClass.name}" avec succès !`, 'success');
      setShowChangeClassModal(false);
      setSelectedStudentForClassChange(null);
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || "Erreur lors du changement de classe.", 'warning');
    } finally {
      setChangingClass(false);
    }
  };

  // Handlers - Real Attendance Management
  const handleCreateAttendanceSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!school?.id || !newSessionClassId || !newSessionDate) {
      showToast('La classe et la date sont obligatoires.', 'warning');
      return;
    }

    setCreatingSession(true);
    try {
      const { data: sessionId, error: sessErr } = await supabase.rpc('create_attendance_session', {
        p_class_id: newSessionClassId,
        p_subject_id: newSessionSubjectId || null,
        p_attendance_date: newSessionDate
      });

      if (sessErr) throw sessErr;

      const activeEnrollments = enrollments.filter(
        e => e.class_id === newSessionClassId && e.status === 'active'
      );

      const enrolledStudents = students.filter(st =>
        activeEnrollments.some(e => e.student_id === st.id) || st.class_id === newSessionClassId
      );

      if (enrolledStudents.length > 0) {
        for (const st of enrolledStudents) {
          await supabase.rpc('update_student_attendance', {
            p_session_id: sessionId,
            p_student_id: st.id,
            p_status: 'present'
          });
        }
      }

      showToast('Nouvelle séance de présence créée avec succès !', 'success');
      setShowNewSessionModal(false);
      loadSchoolPortalData();

      const createdSess: AttendanceSessionRow = {
        id: sessionId,
        school_id: school.id,
        class_id: newSessionClassId,
        academic_year_id: classes.find(c => c.id === newSessionClassId)?.academic_year_id || '',
        term_id: null,
        subject_id: newSessionSubjectId || null,
        teacher_id: null,
        attendance_date: newSessionDate,
        started_at: new Date().toISOString(),
        completed_at: null,
        status: 'draft',
        notes: null,
        reopen_reason: null,
        created_by: profile?.id || '',
        created_at: new Date().toISOString()
      };

      openTakeAttendanceSheet(createdSess);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création de la séance.', 'warning');
    } finally {
      setCreatingSession(false);
    }
  };

  const openTakeAttendanceSheet = (session: AttendanceSessionRow) => {
    setSelectedSession(session);
    
    const classEnrs = enrollments.filter(e => e.class_id === session.class_id && e.status === 'active');
    const classStds = students.filter(st => classEnrs.some(e => e.student_id === st.id) || st.class_id === session.class_id);
    const existingRecords = studentAttendanceRecords.filter(sa => sa.attendance_session_id === session.id);

    const sheetData = classStds.map(st => {
      const existing = existingRecords.find(r => r.student_id === st.id);
      const enr = classEnrs.find(e => e.student_id === st.id);

      return {
        student: st,
        enrollment_id: enr?.id || st.id,
        status: (existing?.status as any) || 'present',
        arrival_time: existing?.arrival_time || '',
        justification: existing?.justification || '',
        justified: existing?.justified || false
      };
    });

    setSheetRecords(sheetData);
    setShowTakeAttendanceModal(true);
  };

  const handleMarkAllPresent = () => {
    setSheetRecords(prev => prev.map(item => ({ ...item, status: 'present' })));
    showToast('Tous les élèves de la classe marqués Présents.', 'info');
  };

  const handleUpdateSheetItem = (studentId: string, updates: Partial<(typeof sheetRecords)[0]>) => {
    setSheetRecords(prev => prev.map(item => item.student.id === studentId ? { ...item, ...updates } : item));
  };

  const handleSaveAttendanceSheet = async (complete: boolean) => {
    if (!selectedSession || !school?.id) return;
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
        complete ? 'Appel de présence finalisé avec succès !' : 'Brouillon de présence enregistré avec succès !',
        'success'
      );
      setShowTakeAttendanceModal(false);
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’enregistrement de l’appel.', 'warning');
    } finally {
      setSavingAttendance(false);
    }
  };

  const handleReopenAttendanceSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !reopenReasonText.trim() || !school?.id) {
      showToast('Le motif de réouverture est obligatoire.', 'warning');
      return;
    }

    setReopeningSession(true);
    try {
      const { error } = await supabase.rpc('reopen_attendance_session', {
        p_session_id: selectedSession.id,
        p_reason: reopenReasonText.trim()
      });

      if (error) throw error;

      showToast('Séance de présence rouverte avec succès !', 'info');
      setShowReopenModal(false);
      setReopenReasonText('');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la réouverture de la séance.', 'warning');
    } finally {
      setReopeningSession(false);
    }
  };

  const openCorrectionForStudent = (
    item: (typeof sheetRecords)[0],
    targetStatus: 'present' | 'absent' | 'late' | 'excused' | 'left_early'
  ) => {
    setCorrectionTarget({
      student: item.student,
      enrollment_id: item.enrollment_id,
      oldStatus: item.status,
      newStatus: targetStatus,
      arrivalTime: item.arrival_time || '',
      justification: item.justification || ''
    });
    setCorrectionReasonText('');
    setShowIndividualCorrectionModal(true);
  };

  const handleConfirmIndividualCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !correctionTarget || !correctionReasonText.trim()) {
      showToast('Le motif administratif de la correction est obligatoire.', 'warning');
      return;
    }

    setSubmittingCorrection(true);
    try {
      const { error } = await supabase.rpc('update_student_attendance', {
        p_session_id: selectedSession.id,
        p_student_id: correctionTarget.student.id,
        p_status: correctionTarget.newStatus,
        p_arrival_time: correctionTarget.arrivalTime || null,
        p_justification: correctionTarget.justification.trim() || null,
        p_reason: correctionReasonText.trim()
      });

      if (error) throw error;

      setSheetRecords(prev =>
        prev.map(r =>
          r.student.id === correctionTarget.student.id
            ? {
                ...r,
                status: correctionTarget.newStatus,
                arrival_time: correctionTarget.arrivalTime,
                justification: correctionTarget.justification
              }
            : r
        )
      );

      showToast('Présence corrigée avec succès et enregistrée dans le journal d\'audit.', 'success');
      setShowIndividualCorrectionModal(false);
      setCorrectionTarget(null);
      setCorrectionReasonText('');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la correction de la présence.', 'warning');
    } finally {
      setSubmittingCorrection(false);
    }
  };

  // Handlers - Teacher Invitation & Suspension (Phase 2D)
  const [invitingTeacherId, setInvitingTeacherId] = useState<string | null>(null);
  const [togglingTeacherId, setTogglingTeacherId] = useState<string | null>(null);

  const handleInviteTeacher = async (teacher: TeacherRow) => {
    if (!teacher.email || !teacher.email.includes('@')) {
      showToast('Cet enseignant ne possède pas une adresse email valide.', 'warning');
      return;
    }

    setInvitingTeacherId(teacher.id);
    try {
      const { data, error } = await supabase.functions.invoke('invite-school-teacher', {
        body: { teacher_id: teacher.id }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      showToast(`Invitation envoyée avec succès à ${teacher.first_name} ${teacher.last_name} (${teacher.email}) !`, 'success');
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’envoi de l’invitation.', 'warning');
    } finally {
      setInvitingTeacherId(null);
    }
  };

  const handleToggleTeacherStatus = async (teacher: TeacherRow, action: 'suspend' | 'reactivate') => {
    setTogglingTeacherId(teacher.id);
    try {
      const { error } = await supabase.rpc('toggle_teacher_status', {
        p_teacher_id: teacher.id,
        p_action: action
      });

      if (error) throw error;

      showToast(
        action === 'suspend'
          ? `Compte de ${teacher.first_name} ${teacher.last_name} suspendu avec succès.`
          : `Compte de ${teacher.first_name} ${teacher.last_name} réactivé avec succès.`,
        'info'
      );
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du changement de statut de l’enseignant.', 'warning');
    } finally {
      setTogglingTeacherId(null);
    }
  };

  // Handlers - Parent Invitation & Management (Phase 2E.1)
  const handleInviteParentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pFirstName.trim() || !pLastName.trim() || !pEmail.trim()) {
      showToast('Le prénom, le nom et l’email du responsable sont obligatoires.', 'warning');
      return;
    }

    if (pStudentIds.length === 0) {
      showToast('Veuillez sélectionner au moins un élève rattaché à ce responsable.', 'warning');
      return;
    }

    setInvitingParent(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-school-parent', {
        body: {
          first_name: pFirstName.trim(),
          last_name: pLastName.trim(),
          email: pEmail.trim(),
          phone: pPhone.trim() || null,
          relationship: pRelationship,
          student_ids: pStudentIds,
          permissions: {
            can_view_academic: pCanAcademic,
            can_view_attendance: pCanAttendance,
            can_view_homework: pCanHomework,
            can_view_finances: pCanFinances,
            can_receive_notifications: pCanNotifications,
            can_pickup_student: pCanPickup
          },
          action: 'invite'
        }
      });

      if (error) {
        let msg = error.message;
        let code = '';
        try {
          if ((error as any).context && typeof (error as any).context.json === 'function') {
            const errBody = await (error as any).context.json();
            if (errBody?.error) msg = errBody.error;
            if (errBody?.error_code) code = errBody.error_code;
          }
        } catch (_e) {
          // ignore
        }

        if (code === 'rate_limit_exceeded') {
          msg = 'Limite temporaire d’envoi d’emails atteinte. Veuillez patienter avant de réessayer.';
        } else if (code === 'email_exists') {
          msg = 'Cette adresse email est déjà associée à un compte existant.';
        } else if (code === 'smtp_error') {
          msg = 'Échec du serveur de messagerie. Vérifiez la configuration SMTP ou l’adresse saisie.';
        } else if (code === 'invitation_processing_failed') {
          msg = 'La création scolaire du responsable n’a pas pu être finalisée. L’opération a été annulée.';
        }

        throw new Error(msg);
      }

      if (data?.error) throw new Error(data.error);

      showToast(data?.message || 'Invitation envoyée avec succès au parent !', 'success');
      setShowParentModal(false);
      setPFirstName('');
      setPLastName('');
      setPEmail('');
      setPPhone('');
      setPStudentIds([]);
      setPRelationship('Père');
      setPCanAcademic(true);
      setPCanAttendance(true);
      setPCanHomework(true);
      setPCanFinances(true);
      setPCanNotifications(true);
      setPCanPickup(false);
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’invitation du parent.', 'warning');
    } finally {
      setInvitingParent(false);
    }
  };

  const handleReinviteParent = async (parent: ParentRow) => {
    try {
      const { data, error } = await supabase.functions.invoke('invite-school-parent', {
        body: {
          parent_profile_id: parent.parent_profile_id,
          action: 'reinvite'
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      showToast('Nouvelle invitation envoyée.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du renvoi de l’invitation.', 'warning');
    }
  };

  const handleToggleParentStatus = async (parent: ParentRow, action: 'suspend' | 'reactivate') => {
    setTogglingParentId(parent.parent_profile_id);
    try {
      const { error } = await supabase.rpc('toggle_parent_status', {
        p_parent_profile_id: parent.parent_profile_id,
        p_action: action
      });

      if (error) throw error;

      showToast(
        action === 'suspend'
          ? `Compte de ${parent.first_name} ${parent.last_name} suspendu avec succès.`
          : `Compte de ${parent.first_name} ${parent.last_name} réactivé avec succès.`,
        'info'
      );
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du changement de statut du parent.', 'warning');
    } finally {
      setTogglingParentId(null);
    }
  };

  const handleManageLinkAction = async (
    linkId: string,
    action: 'approve' | 'revoke' | 'reject' | 'update_permissions',
    relationship?: string,
    permissions?: any
  ) => {
    try {
      const { error } = await supabase.rpc('manage_parent_student_link', {
        p_link_id: linkId,
        p_action: action,
        p_relationship: relationship || null,
        p_permissions: permissions || null
      });

      if (error) throw error;

      showToast(
        action === 'approve'
          ? 'Lien parent-élève approuvé avec succès.'
          : action === 'revoke'
          ? 'Lien parent-élève révoqué avec succès.'
          : action === 'reject'
          ? 'Lien parent-élève rejeté.'
          : 'Permissions du lien mises à jour.',
        'success'
      );
      setShowEditLinkModal(false);
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la mise à jour du lien.', 'warning');
    }
  };

  // Handlers - Student Invitation & Management (Phase 2E.1)
  const handleOpenStudentInviteModal = (student: StudentRow) => {
    setSelectedStudentForInvite(student);
    setStudentInviteEmail(student.email || '');
    setShowStudentInviteModal(true);
  };

  const parseStudentInviteError = async (error: any, fallbackBodyError?: string): Promise<string> => {
    let techDetails = error ? error.message : fallbackBodyError;

    if (error) {
      try {
        if ((error as any).context && typeof (error as any).context.json === 'function') {
          const errBody = await (error as any).context.json();
          if (errBody?.error) {
            techDetails = errBody.error;
          }
        }
      } catch (_e) {
        // ignore context parse error
      }
    }

    const techLower = String(techDetails || '').toLowerCase();

    if (error?.name === 'FunctionsFetchError' || techLower.includes('failed to send a request')) {
      return 'Le service d’invitation est momentanément indisponible. Veuillez réessayer.';
    }
    if (techLower.includes('session') || techLower.includes('authentifié') || techLower.includes('jeton expiré')) {
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    }
    if (techLower.includes('déjà associée') || techLower.includes('compte existant') || techLower.includes('déjà utilisée')) {
      return 'Cette adresse email est déjà associée à un compte ÉcoleConnect. Veuillez vérifier l’identité de l’élève.';
    }
    if (techLower.includes('première invitation refusée') || techLower.includes('statut exact "not_invited"') || techLower.includes('déjà active')) {
      return 'Une invitation est déjà active pour cet élève. Utilisez l’option de renvoi d’invitation si nécessaire.';
    }
    if (techLower.includes('serveur de messagerie') || techLower.includes('limite temporaire') || techLower.includes('email d’invitation') || techLower.includes('fournisseur')) {
      return 'L’invitation n’a pas pu être envoyée par email. Veuillez réessayer plus tard.';
    }
    if (techLower.includes('pas à votre établissement') || techLower.includes('accès refusé')) {
      return 'Vous n’avez pas les droits d’administration nécessaires pour cet élève.';
    }
    if (techLower.includes('adresse email personnelle valide est requise')) {
      return 'Une adresse email personnelle valide est requise pour inviter l’élève.';
    }
    if (techLower.includes('dossier élève introuvable')) {
      return 'Dossier élève introuvable dans cet établissement.';
    }

    return 'Le service d’invitation est momentanément indisponible. Veuillez réessayer.';
  };

  const handleInviteStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudentForInvite || invitingStudentId !== null) return;

    const trimmedEmail = studentInviteEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      showToast('Une adresse email personnelle valide est requise pour inviter l’élève.', 'warning');
      return;
    }

    // 1. Vérification / Renouvellement de la session Supabase
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !sessionData?.session) {
      showToast('Votre session a expiré. Veuillez vous reconnecter.', 'warning');
      return;
    }

    setInvitingStudentId(selectedStudentForInvite.id);
    try {
      const { data, error } = await supabase.functions.invoke('invite-school-student', {
        body: {
          student_id: selectedStudentForInvite.id,
          email: trimmedEmail,
          action: 'invite'
        }
      });

      if (error || data?.error) {
        console.error('[invite-school-student] Technical error:', error || data?.error);
        const userMsg = await parseStudentInviteError(error, data?.error);
        showToast(userMsg, 'warning');
        return;
      }

      showToast(data?.message || 'Invitation envoyée avec succès à l’élève !', 'success');
      setShowStudentInviteModal(false);
      setSelectedStudentForInvite(null);
      setStudentInviteEmail('');
      loadSchoolPortalData();
    } catch (err: any) {
      console.error('[invite-school-student] Unexpected error:', err);
      const userMsg = await parseStudentInviteError(err);
      showToast(userMsg, 'warning');
    } finally {
      setInvitingStudentId(null);
    }
  };

  const handleReinviteStudent = async (student: StudentRow) => {
    if (invitingStudentId !== null) return;

    // 1. Vérification / Renouvellement de la session Supabase
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !sessionData?.session) {
      showToast('Votre session a expiré. Veuillez vous reconnecter.', 'warning');
      return;
    }

    setInvitingStudentId(student.id);
    try {
      const { data, error } = await supabase.functions.invoke('invite-school-student', {
        body: {
          student_id: student.id,
          email: student.email,
          action: 'reinvite'
        }
      });

      if (error || data?.error) {
        console.error('[reinvite-school-student] Technical error:', error || data?.error);
        const userMsg = await parseStudentInviteError(error, data?.error);
        showToast(userMsg, 'warning');
        return;
      }

      showToast(data?.message || 'Nouvelle invitation envoyée.', 'success');
    } catch (err: any) {
      console.error('[reinvite-school-student] Unexpected error:', err);
      const userMsg = await parseStudentInviteError(err);
      showToast(userMsg, 'warning');
    } finally {
      setInvitingStudentId(null);
    }
  };

  const handleToggleStudentStatus = async (student: StudentRow, action: 'suspend' | 'reactivate') => {
    setTogglingStudentId(student.id);
    try {
      const { error } = await supabase.rpc('toggle_student_status', {
        p_student_id: student.id,
        p_action: action
      });

      if (error) throw error;

      showToast(
        action === 'suspend'
          ? `Compte de ${student.first_name || student.student_number} suspendu avec succès.`
          : `Compte de ${student.first_name || student.student_number} réactivé avec succès.`,
        'info'
      );
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du changement de statut de l’élève.', 'warning');
    } finally {
      setTogglingStudentId(null);
    }
  };

  // Handlers - Teacher Assignment
  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();

    const activeYear = academicYears.find(y => y.is_current) || academicYears[0];
    if (!activeYear?.id) {
      showToast('Aucune année scolaire active. Activez une année scolaire avant de créer une affectation.', 'warning');
      return;
    }

    const selectedClassId = assignClassId || classes[0]?.id;
    const selectedTeacherId = assignTeacherId || teachers[0]?.id;
    const targetClass = classes.find(c => c.id === selectedClassId);
    const isPrimaryHomeroom = targetClass?.pedagogical_mode === 'primary_homeroom';

    if (!selectedClassId || !selectedTeacherId) {
      showToast('La classe et l’enseignant sont obligatoires.', 'warning');
      return;
    }

    const targetTeacher = teachers.find(t => t.id === selectedTeacherId);
    if (!targetTeacher) {
      showToast('Enseignant introuvable.', 'warning');
      return;
    }

    try {
      if (isPrimaryHomeroom) {
        const currentHomeroomTeacherId = targetClass?.homeroom_teacher_id;
        const isReplacing = currentHomeroomTeacherId &&
          currentHomeroomTeacherId !== targetTeacher.profile_id &&
          currentHomeroomTeacherId !== targetTeacher.id;

        if (isReplacing) {
          setPendingPrimaryReplace({
            classId: selectedClassId,
            teacherId: targetTeacher.id,
            className: targetClass?.name || '',
            newTeacherName: `${targetTeacher.first_name} ${targetTeacher.last_name}`
          });
          setShowConfirmReplaceHomeroom(true);
          return;
        }

        const { error } = await supabase.rpc('assign_class_homeroom_teacher', {
          p_class_id: selectedClassId,
          p_teacher_id: targetTeacher.id
        });

        if (error) throw error;
        showToast('Enseignant titulaire affecté à la classe primaire avec succès !', 'success');
      } else {
        const selectedSubjectId = assignSubjectId || subjects[0]?.id;
        if (!selectedSubjectId) {
          showToast('La matière est obligatoire pour une classe en mode secondaire par matière.', 'warning');
          return;
        }

        const targetSubject = subjects.find(s => s.id === selectedSubjectId);
        if (!targetSubject) {
          showToast('Matière introuvable.', 'warning');
          return;
        }

        const { error } = await supabase.rpc('assign_teacher_subject', {
          p_class_id: selectedClassId,
          p_teacher_id: targetTeacher.id,
          p_subject_id: targetSubject.id
        });

        if (error) throw error;
        showToast('Affectation enseignant enregistrée avec succès !', 'success');
      }

      setShowAssignModal(false);
      loadSchoolPortalData();
    } catch (err: any) {
      if (err?.code === '23505' || err?.message?.includes('23505') || err?.message?.includes('duplicate key')) {
        showToast('Cette affectation active existe déjà.', 'warning');
      } else {
        showToast(err.message || 'Erreur lors de la création de l’affectation.', 'warning');
      }
    }
  };

  // CSV Import File Processing
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportValidationErrors([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r\n|\n/).filter(line => line.trim().length > 0);
      if (lines.length < 2) {
        setImportValidationErrors(['Le fichier CSV ne contient aucune ligne de données.']);
        return;
      }
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const parsedRows = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const rowVals = lines[i].split(',').map(v => v.trim());
        const rowObj: any = {};
        headers.forEach((h, idx) => {
          rowObj[h] = rowVals[idx] || '';
        });

        if (importType === 'teachers') {
          if (!rowObj.matricule || !rowObj.prenom || !rowObj.nom) {
            errors.push(`Ligne ${i + 1} : Champs obligatoires manquants (matricule, prenom, nom).`);
          }
        } else if (importType === 'students') {
          if (!rowObj.matricule || !rowObj.prenom || !rowObj.nom) {
            errors.push(`Ligne ${i + 1} : Champs obligatoires manquants (matricule, prenom, nom).`);
          }
          const targetClassName = (rowObj.classe || rowObj.nom_classe || rowObj.class_name || '').trim();
          if (targetClassName) {
            const foundClass = classes.find(c =>
              c.name.trim().toLowerCase() === targetClassName.toLowerCase() ||
              `${c.level || ''} ${c.name}`.trim().toLowerCase() === targetClassName.toLowerCase()
            );
            if (!foundClass) {
              errors.push(`Ligne ${i + 1} : La classe "${targetClassName}" n'existe pas dans l'établissement.`);
            } else {
              rowObj._resolved_class_id = foundClass.id;
              rowObj._resolved_academic_year_id = foundClass.academic_year_id;
            }
          }
        } else if (importType === 'classes') {
          if (!rowObj.nom_classe) {
            errors.push(`Ligne ${i + 1} : Champ nom_classe manquant.`);
          }
        }
        parsedRows.push(rowObj);
      }

      setImportPreviewRows(parsedRows);
      setImportValidationErrors(errors);
    };
    reader.readAsText(file);
  };

  // Confirm Import Batch
  const handleConfirmImport = async () => {
    if (!school?.id || importPreviewRows.length === 0) return;
    if (importValidationErrors.length > 0) {
      showToast('Veuillez corriger les erreurs du fichier CSV avant confirmation.', 'warning');
      return;
    }

    setIsProcessingImport(true);
    try {
      // 1. Create Import Job
      const { data: jobData, error: jobErr } = await supabase
        .from('school_import_jobs')
        .insert({
          school_id: school.id,
          import_type: importType,
          file_name: importFile?.name || 'import.csv',
          status: 'processing',
          total_rows: importPreviewRows.length,
          created_by: profile?.id
        })
        .select('id')
        .single();

      if (jobErr) throw jobErr;

      let insertedCount = 0;

      if (importType === 'teachers') {
        const insertBatch = importPreviewRows.map(r => ({
          school_id: school.id,
          employee_number: r.matricule,
          first_name: r.prenom,
          last_name: r.nom,
          email: r.email || null,
          phone: r.telephone || null,
          gender: r.sexe === 'F' ? 'F' : 'M',
          speciality: r.specialite || null,
          employment_status: 'active',
          account_status: 'not_invited'
        }));
        const { error } = await supabase.from('teachers').insert(insertBatch);
        if (error) throw error;
        insertedCount = insertBatch.length;
      } else if (importType === 'students') {
        const activeYear = academicYears.find(y => y.is_current) || academicYears[0];
        
        for (let i = 0; i < importPreviewRows.length; i++) {
          const r = importPreviewRows[i];
          const targetClassId = r._resolved_class_id || null;
          const targetYearId = r._resolved_academic_year_id || activeYear?.id;

          const { data: stdData, error: stdErr } = await supabase
            .from('students')
            .insert({
              school_id: school.id,
              student_number: r.matricule,
              first_name: r.prenom,
              last_name: r.nom,
              middle_name: r.postnom || null,
              date_of_birth: r.date_naissance || null,
              birth_place: r.lieu_naissance || null,
              gender: r.sexe === 'F' ? 'F' : 'M',
              class_id: targetClassId,
              guardian_reference: r.nom_tuteur || null,
              account_status: 'not_invited'
            })
            .select('id')
            .single();

          if (stdErr) throw stdErr;

          if (stdData?.id && targetClassId && targetYearId) {
            const { error: enrErr } = await supabase
              .from('student_enrollments')
              .insert({
                school_id: school.id,
                student_id: stdData.id,
                academic_year_id: targetYearId,
                class_id: targetClassId,
                status: 'active',
                enrolled_on: new Date().toISOString().split('T')[0]
              });

            if (enrErr) throw enrErr;
          }
          insertedCount++;
        }
      } else if (importType === 'classes') {
        const activeYear = academicYears.find(y => y.is_current) || academicYears[0];
        if (!activeYear) throw new Error("Veuillez d'abord configurer une année scolaire.");
        const insertBatch = importPreviewRows.map(r => ({
          school_id: school.id,
          academic_year_id: activeYear.id,
          name: r.nom_classe,
          level: r.niveau || 'Général',
          section: r.section || 'A',
          room: r.salle || 'S101',
          is_active: true
        }));
        const { error } = await supabase.from('classes').insert(insertBatch);
        if (error) throw error;
        insertedCount = insertBatch.length;
      }

      // Update Import Job Status
      await supabase.from('school_import_jobs').update({
        status: 'completed',
        valid_rows: insertedCount
      }).eq('id', jobData.id);

      showToast(`Importation de ${insertedCount} ${importType} réalisée avec succès !`, 'success');
      setShowImportModal(false);
      setImportFile(null);
      setImportPreviewRows([]);
      loadSchoolPortalData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du traitement de l’importation.', 'warning');
    } finally {
      setIsProcessingImport(false);
    }
  };

  // Calculate Onboarding Progress Percentage (0 - 100%)
  const currentYearObj = academicYears.find(y => y.is_current);
  const stepsCompleted = [
    !!school?.name,
    !!currentYearObj,
    schoolTerms.length > 0,
    subjects.length > 0,
    classes.length > 0,
    teachers.length > 0,
    students.length > 0,
    assignments.length > 0
  ];
  const progressPercent = Math.round((stepsCompleted.filter(Boolean).length / stepsCompleted.length) * 100);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 space-y-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Chargement du portail de l'établissement...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-amber-500 selection:text-white">
      {/* Header Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-amber-400 uppercase tracking-wider">{school?.name}</span>
              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-bold">
                {school?.status === 'active' ? 'Opérationnel' : 'Archivé/Suspendu'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">ID École : {school?.slug}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-white">{profile?.first_name} {profile?.last_name}</p>
            <p className="text-[10px] text-slate-400">
              {profile?.role === 'finance_agent' ? 'Agent financier' : 'Administrateur d\'Établissement'}
            </p>
          </div>
          <button
            onClick={signOutReal}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="Se déconnecter"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="relative bg-slate-900/80 border-b border-slate-800">
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-slate-900 via-slate-900/80 to-transparent pointer-events-none flex items-center justify-start pl-2 z-10 transition-opacity duration-300">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400/60" />
          </div>
        )}

        <nav
          ref={navRef}
          onWheel={handleNavWheel}
          className="px-4 sm:px-6 py-2 overflow-x-auto scrollbar-none flex items-center gap-1 text-xs scroll-smooth"
          aria-label="Navigation principale administrateur"
        >
          {[
            { id: 'vue_densemble', label: 'Vue d’ensemble', icon: Activity },
            { id: 'finance', label: 'Finance & Frais', icon: DollarSign },
            { id: 'annees_scolaires', label: `Années (${academicYears.length})`, icon: Calendar },
            { id: 'trimestres', label: `Calendrier Scolaire (${schoolTerms.length})`, icon: Clock },
            { id: 'matieres', label: `Matières (${subjects.length})`, icon: BookMarked },
            { id: 'coefficients', label: 'Coefficients', icon: Sliders },
            { id: 'classes', label: `Classes (${classes.length})`, icon: BookOpen },
            { id: 'enseignants', label: `Enseignants (${teachers.length})`, icon: UserCheck },
            { id: 'parents', label: `Parents (${parents.length})`, icon: Users },
            { id: 'eleves', label: `Élèves (${students.length})`, icon: GraduationCap },
            { id: 'presences', label: `Présences (${attendanceSessions.length})`, icon: CalendarCheck },
            { id: 'devoirs', label: `Devoirs (${adminHomeworkList.length})`, icon: FileText },
            { id: 'emploi_du_temps', label: 'Emploi du temps', icon: CalendarDays },
            { id: 'notes', label: `Notes (${adminAssessmentsCount})`, icon: Award },
            { id: 'affectations', label: `Affectations (${assignments.length})`, icon: Layers },
            { id: 'importations', label: `Importations (${importJobs.length})`, icon: Upload },
            { id: 'documents', label: 'Documents scolaires', icon: FileCheck },
            { id: 'parametres', label: 'Paramètres', icon: Settings }
          ]
            .filter(tab => !isFinanceAgent || tab.id === 'finance')
            .map(tab => {
              const IconComp = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={isActive ? activeTabRef : null}
                  onClick={() => setActiveTab(tab.id as SchoolAdminTab)}
                  className={`px-3.5 py-2 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap flex-shrink-0 ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 font-black shadow-md'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <IconComp className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
        </nav>

        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-slate-900 via-slate-900/80 to-transparent pointer-events-none flex items-center justify-end pr-2 z-10 transition-opacity duration-300">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-sm shadow-amber-500/50" title="Plus d'onglets disponibles" />
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-8">
        {/* TAB FINANCE (Exclusif finance_agent ou onglet actif) */}
        {(isFinanceAgent || activeTab === 'finance') && school?.id && (
          <FinanceDashboardModule schoolId={school.id} />
        )}

        {/* ONGLETS ADMINISTRATIFS (Masqués pour finance_agent) */}
        {!isFinanceAgent && (
          <>
            {/* TAB 1: VUE D'ENSEMBLE */}
            {activeTab === 'vue_densemble' && (
          <div className="space-y-6">
            {/* Onboarding Wizard Card */}
            <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-900 to-amber-950/40 rounded-3xl border border-amber-500/30 space-y-4 shadow-xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                    <span>Assistant de Mise en Service</span>
                    <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-500/30">
                      {progressPercent}% Complété
                    </span>
                  </h2>
                  <p className="text-xs text-slate-300 mt-1">
                    Progression calculée en direct sur la base des configurations enregistrées dans Supabase.
                  </p>
                </div>

                <div className="w-full sm:w-48 bg-slate-950 rounded-full h-3 p-0.5 border border-slate-800 overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pt-2">
                {[
                  { label: 'Année active', done: !!currentYearObj, tab: 'annees_scolaires' },
                  { label: 'Calendrier Scolaire', done: schoolTerms.length > 0, tab: 'trimestres' },
                  { label: 'Matières ajoutées', done: subjects.length > 0, tab: 'matieres' },
                  { label: 'Classes créées', done: classes.length > 0, tab: 'classes' },
                  { label: 'Enseignants inscrits', done: teachers.length > 0, tab: 'enseignants' },
                  { label: 'Élèves préenregistrés', done: students.length > 0, tab: 'eleves' },
                  { label: 'Affectations liées', done: assignments.length > 0, tab: 'affectations' },
                  { label: 'École prêt à opérer', done: progressPercent === 100, tab: 'vue_densemble' }
                ].map((step, idx) => (
                  <div
                    key={idx}
                    onClick={() => setActiveTab(step.tab as SchoolAdminTab)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-2.5 ${
                      step.done
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <CheckCircle2 className={`w-4 h-4 shrink-0 ${step.done ? 'text-emerald-400' : 'text-slate-600'}`} />
                    <span className="font-bold text-[11px]">{step.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Metrics Counters */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase">Élèves Inscrits</p>
                <p className="text-3xl font-black text-amber-400">{students.length}</p>
                <p className="text-[10px] text-slate-500">Dossiers préenregistrés</p>
              </div>

              <div className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase">Personnel Enseignant</p>
                <p className="text-3xl font-black text-white">{teachers.length}</p>
                <p className="text-[10px] text-slate-500">Professeurs dans le registre</p>
              </div>

              <div className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase">Classes Opérationnelles</p>
                <p className="text-3xl font-black text-white">{classes.length}</p>
                <p className="text-[10px] text-slate-500">Salles de cours actives</p>
              </div>

              <div className="p-5 bg-slate-900 rounded-3xl border border-slate-800 space-y-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase">Année Académique</p>
                <p className="text-3xl font-black text-emerald-400">{currentYearObj ? currentYearObj.name : 'Non définie'}</p>
                <p className="text-[10px] text-slate-500">{subjects.length} Matière(s) configurée(s)</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: ANNÉES SCOLAIRES */}
        {activeTab === 'annees_scolaires' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Années Scolaires</h3>
                <p className="text-xs text-slate-400">Une seule année peut être désignée comme année courante active</p>
              </div>
              <button
                onClick={() => setShowYearModal(true)}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Créer l’Année Scolaire</span>
              </button>
            </div>

            {academicYears.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <Calendar className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucune année scolaire n'est configurée pour cet établissement.</p>
                <button
                  onClick={() => setShowYearModal(true)}
                  className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  Configurer la première année
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Libellé</th>
                      <th className="p-3">Période Début - Fin</th>
                      <th className="p-3">Statut</th>
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

        {/* TAB 3: CALENDRIER SCOLAIRE & DÉCOUPAGE RDC */}
        {activeTab === 'trimestres' && (
          <div className="space-y-6">
            {/* Header & Quick Action Buttons */}
            <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <h3 className="font-extrabold text-base text-white flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-400" />
                    <span>Calendrier Scolaire & Découpage RDC</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Organisation et datation des trimestres, semestres et périodes pour l'année scolaire active ({currentYearObj ? currentYearObj.name : 'Aucune année active'})
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(!school?.education_cycles || school.education_cycles.includes('primary')) && (
                    <button
                      onClick={() => {
                        setDrcConfigCycle('primary');
                        setDrcAdoptLegacy(false);
                        setShowDrcConfigModal(true);
                      }}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Générer Structure Primaire (3T / 9P)</span>
                    </button>
                  )}

                  {(!school?.education_cycles || school.education_cycles.includes('secondary')) && (
                    <button
                      onClick={() => {
                        setDrcConfigCycle('secondary');
                        setDrcAdoptLegacy(false);
                        setShowDrcConfigModal(true);
                      }}
                      className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Générer Structure Secondaire (2S / 4P)</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* SECTION 1: CYCLE PRIMAIRE (3 Trimestres / 9 Périodes) */}
            {(!school?.education_cycles || school.education_cycles.includes('primary')) && (() => {
              const cal = schoolCalendars.find(c => c.academic_year_id === currentYearObj?.id && c.education_cycle === 'primary');
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
                            <span>{activatingCalendarCycle === 'primary' ? 'Activation...' : 'Activer le Calendrier Primaire'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setConfigErrorsCycle('primary');
                              setShowConfigErrorsModal(true);
                            }}
                            className="px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                            <span>Voir erreurs ({errs.length})</span>
                          </button>
                        )
                      ) : status === 'active' ? (
                        <>
                          <button
                            onClick={() => handleOpenReopenModal('primary')}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Rouvrir en Brouillon</span>
                          </button>
                          <button
                            onClick={() => handleOpenCloseModal('primary')}
                            className="px-3.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
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
                          <span>Rouvrir le Calendrier</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {schoolTerms.filter(t => t.education_cycle === 'primary').length === 0 ? (
                    <div className="p-6 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
                      <p className="text-slate-400">Le calendrier du cycle primaire n'a pas encore été généré pour cette année.</p>
                      <button
                        onClick={() => {
                          setDrcConfigCycle('primary');
                          setDrcAdoptLegacy(true);
                          setShowDrcConfigModal(true);
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl cursor-pointer inline-flex items-center gap-1 text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Générer 3 Trimestres & 9 Périodes Primaires</span>
                      </button>
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

                                {/* Term Dates info */}
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

                                {/* Associated Periods with their dates */}
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

            {/* SECTION 2: CYCLE SECONDAIRE (2 Semestres / 4 Périodes) */}
            {(!school?.education_cycles || school.education_cycles.includes('secondary')) && (() => {
              const cal = schoolCalendars.find(c => c.academic_year_id === currentYearObj?.id && c.education_cycle === 'secondary');
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
                            <span>{activatingCalendarCycle === 'secondary' ? 'Activation...' : 'Activer le Calendrier Secondaire'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setConfigErrorsCycle('secondary');
                              setShowConfigErrorsModal(true);
                            }}
                            className="px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                            <span>Voir erreurs ({errs.length})</span>
                          </button>
                        )
                      ) : status === 'active' ? (
                        <>
                          <button
                            onClick={() => handleOpenReopenModal('secondary')}
                            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>Rouvrir en Brouillon</span>
                          </button>
                          <button
                            onClick={() => handleOpenCloseModal('secondary')}
                            className="px-3.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Clôturer</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleOpenReopenModal('secondary')}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Rouvrir le Calendrier</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {schoolTerms.filter(t => t.education_cycle === 'secondary').length === 0 ? (
                    <div className="p-6 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
                      <p className="text-slate-400">Le calendrier du cycle secondaire n'a pas encore été généré pour cette année.</p>
                      <button
                        onClick={() => {
                          setDrcConfigCycle('secondary');
                          setDrcAdoptLegacy(false);
                          setShowDrcConfigModal(true);
                        }}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl cursor-pointer inline-flex items-center gap-1 text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Générer 2 Semestres & 4 Périodes Secondaires</span>
                      </button>
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

                                {/* Term Dates info */}
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

                                {/* Associated Periods with their dates */}
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

            {/* SECTION 3: TRIMESTRES HISTORIQUES (LEGACY SANS CYCLE) */}
            {schoolTerms.filter(t => !t.education_cycle).length > 0 && (
              <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded-full font-bold text-xs">
                      Trimestres Historiques / Non Assignés
                    </span>
                    <span className="text-xs text-slate-400">Préservés sans altération automatique</span>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                        <th className="p-3">Position</th>
                        <th className="p-3">Intitulé</th>
                        <th className="p-3">Dates</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {schoolTerms
                        .filter(t => !t.education_cycle)
                        .map(t => (
                          <tr key={t.id}>
                            <td className="p-3 font-mono font-bold text-amber-400">#{t.position}</td>
                            <td className="p-3 font-bold text-white">{t.name}</td>
                            <td className="p-3 font-mono text-slate-300">{t.starts_on || 'N/A'} ➔ {t.ends_on || 'N/A'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: MATIÈRES */}
        {activeTab === 'matieres' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Matières & Cours</h3>
                <p className="text-xs text-slate-400">Registre des matières enseignées dans l'établissement</p>
              </div>
              <button
                onClick={() => setShowSubjectModal(true)}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Créer une Matière</span>
              </button>
            </div>

            {/* Quick Preset Subject Suggestions */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <p className="font-extrabold text-slate-300 uppercase text-[11px]">Suggestions de Matières Courantes (Cliquer pour ajouter) :</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { name: 'Mathématiques', code: 'MATH' },
                  { name: 'Français & Littérature', code: 'FRAN' },
                  { name: 'Sciences de la Vie & Terre', code: 'SVT' },
                  { name: 'Physique-Chimie', code: 'PHYS' },
                  { name: 'Histoire-Géographie', code: 'HIST' },
                  { name: 'Anglais', code: 'ANG' },
                  { name: 'Informatique & Technologie', code: 'INFO' }
                ].map(p => (
                  <button
                    key={p.code}
                    onClick={() => handleAddPresetSubjects(p.name, p.code)}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 border border-slate-800 hover:border-amber-500/40 rounded-xl text-xs font-semibold cursor-pointer transition-all"
                  >
                    + {p.name} ({p.code})
                  </button>
                ))}
              </div>
            </div>

            {subjects.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <BookMarked className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucune matière n'est configurée pour cette école.</p>
                <button
                  onClick={() => setShowSubjectModal(true)}
                  className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  Ajouter une matière
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Code</th>
                      <th className="p-3">Intitulé de la Matière</th>
                      <th className="p-3">Description</th>
                      <th className="p-3">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {subjects.map(s => (
                      <tr key={s.id}>
                        <td className="p-3 font-mono font-bold text-amber-400">{s.code || 'N/A'}</td>
                        <td className="p-3 font-extrabold text-white text-sm">{s.name}</td>
                        <td className="p-3 text-slate-300">{s.description || 'Aucune description'}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full text-[10px] font-bold">
                            Actif
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

        {/* TAB 5: CLASSES */}
        {activeTab === 'classes' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Classes & Salles de Cours</h3>
                <p className="text-xs text-slate-400">Structure des classes avec affectation du cycle scolaire (Primaire / Secondaire)</p>
              </div>
              <button
                onClick={() => {
                  setClassCycle('');
                  setShowClassModal(true);
                }}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Créer une Classe</span>
              </button>
            </div>

            {classes.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <BookOpen className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucune classe n'est créée pour cet établissement.</p>
                <button
                  onClick={() => setShowClassModal(true)}
                  className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  Créer la première classe
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Nom Classe</th>
                      <th className="p-3">Professeur Titulaire</th>
                      <th className="p-3">Cycle Scolaire</th>
                      <th className="p-3">Niveau</th>
                      <th className="p-3">Section</th>
                      <th className="p-3">Salle</th>
                      <th className="p-3">Effectif Réel</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {classes.map(c => {
                      const activeClassEnrollments = enrollments.filter(e => e.class_id === c.id && e.status === 'active');
                      const directClassStudents = students.filter(st => st.class_id === c.id);
                      const realCount = activeClassEnrollments.length > 0 ? activeClassEnrollments.length : directClassStudents.length;
                      const hrTeacher = Boolean(c.homeroom_teacher_id)
                        ? teachers.find(t => Boolean(t.profile_id) && t.profile_id === c.homeroom_teacher_id && t.school_id === school?.id)
                        : null;

                      return (
                        <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="p-3 font-extrabold text-white text-sm">{c.name}</td>
                          <td className="p-3">
                            {hrTeacher ? (
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-extrabold text-white text-xs">{hrTeacher.first_name} {hrTeacher.last_name}</span>
                                  <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-md font-bold text-[9px]">
                                    Titulaire
                                  </span>
                                </div>
                                <span className="font-mono text-amber-400 text-[10px] block">{hrTeacher.employee_number}</span>
                              </div>
                            ) : (
                              <span className="text-slate-500 text-xs italic">Aucun titulaire</span>
                            )}
                          </td>
                          <td className="p-3">
                            {c.education_cycle === 'primary' ? (
                              <span className="px-2.5 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-full font-bold text-[10px]">
                                Primaire (3T/9P)
                              </span>
                            ) : c.education_cycle === 'secondary' ? (
                              <span className="px-2.5 py-1 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full font-bold text-[10px]">
                                Secondaire (2S/4P)
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-full font-bold text-[10px]">
                                Non défini
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-300">{c.level || 'N/A'}</td>
                          <td className="p-3 text-slate-300">{c.section || 'N/A'}</td>
                          <td className="p-3 font-mono text-amber-400">{c.room || 'N/A'}</td>
                          <td className="p-3">
                            <button
                              onClick={() => {
                                setSelectedClassFilterId(c.id);
                                setActiveTab('eleves');
                              }}
                              title="Cliquer pour voir la liste des élèves de cette classe"
                              className="px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl font-extrabold cursor-pointer transition-colors inline-flex items-center gap-1.5"
                            >
                              <Users className="w-3.5 h-3.5" />
                              <span>{realCount} Élève(s)</span>
                            </button>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => {
                                  setSelectedClassForHomeroom(c);
                                  const existingTeacher = Boolean(c.homeroom_teacher_id)
                                    ? teachers.find(t => Boolean(t.profile_id) && t.profile_id === c.homeroom_teacher_id && t.school_id === school?.id)
                                    : null;
                                  setSelectedTeacherIdForHomeroom(existingTeacher?.id || '');
                                  setShowHomeroomModal(true);
                                }}
                                className={`px-2.5 py-1 font-bold rounded-lg transition-colors cursor-pointer text-[11px] border ${
                                  c.homeroom_teacher_id
                                    ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                                    : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border-slate-700'
                                }`}
                                title={c.homeroom_teacher_id ? "Changer ou retirer le professeur titulaire" : "Affecter un professeur titulaire"}
                              >
                                {c.homeroom_teacher_id ? 'Changer Titulaire' : 'Affecter Titulaire'}
                              </button>

                              <button
                                onClick={() => {
                                  setSelectedClassForCycle(c);
                                  setTargetCycleForChange(c.education_cycle || '');
                                  setShowSetCycleModal(true);
                                }}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-300 border border-slate-700 hover:border-amber-500/40 font-bold rounded-lg transition-colors cursor-pointer text-[11px]"
                                title="Définir ou modifier le cycle scolaire de cette classe"
                              >
                                Définir Cycle
                              </button>

                              <button
                                onClick={() => {
                                  setSelectedClassForMode(c);
                                  setTargetPedagogicalMode(c.pedagogical_mode === 'primary_homeroom' ? 'primary_homeroom' : 'secondary_subjects');
                                  setShowPedagogicalModeModal(true);
                                }}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-300 border border-slate-700 hover:border-emerald-500/40 font-bold rounded-lg transition-colors cursor-pointer text-[11px]"
                                title="Définir ou modifier le mode pédagogique (Primaire/Secondaire) de cette classe"
                              >
                                Mode Pédagogique
                              </button>


                              <button
                                onClick={() => {
                                  setSelectedClassFilterId(c.id);
                                  setActiveTab('eleves');
                                }}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg transition-colors cursor-pointer text-[11px]"
                              >
                                Voir élèves ➔
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 6: ENSEIGNANTS */}
        {activeTab === 'enseignants' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-base text-white">Registre des Enseignants</h3>
                <p className="text-xs text-slate-400">Dossiers professionnels des enseignants de l'école</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setImportType('teachers');
                    setShowImportModal(true);
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Importer CSV/XLSX</span>
                </button>

                <button
                  onClick={() => setShowTeacherModal(true)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Ajouter un Enseignant</span>
                </button>
              </div>
            </div>

            {teachers.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <UserCheck className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucun enseignant n'est encore enregistré.</p>
                <div className="flex justify-center gap-2 pt-1">
                  <button
                    onClick={() => setShowTeacherModal(true)}
                    className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl cursor-pointer"
                  >
                    Ajout Manuel
                  </button>
                  <button
                    onClick={() => {
                      setImportType('teachers');
                      setShowImportModal(true);
                    }}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 text-white font-bold rounded-xl cursor-pointer"
                  >
                    Importer CSV
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Matricule</th>
                      <th className="p-3">Nom & Prénom</th>
                      <th className="p-3">Spécialité</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3">Statut Compte</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {teachers.map(t => {
                      const status = t.account_status;
                      const isInviting = invitingTeacherId === t.id;
                      const isToggling = togglingTeacherId === t.id;

                      const isKnownStatus = status === 'active' || status === 'invited' || status === 'suspended' || status === 'not_invited';

                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40">
                          <td className="p-3 font-mono font-bold text-amber-400">{t.employee_number}</td>
                          <td className="p-3 font-extrabold text-white text-sm">{t.first_name} {t.last_name}</td>
                          <td className="p-3 text-slate-300">{t.speciality || 'Général'}</td>
                          <td className="p-3 text-slate-300">{t.email || t.phone || 'N/A'}</td>
                          <td className="p-3">
                            {status === 'active' && (
                              <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-[10px] font-extrabold">
                                Compte actif
                              </span>
                            )}
                            {status === 'invited' && (
                              <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full text-[10px] font-bold">
                                Invitation envoyée
                              </span>
                            )}
                            {status === 'suspended' && (
                              <span className="px-2.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-full text-[10px] font-bold">
                                Suspendu
                              </span>
                            )}
                            {status === 'not_invited' && (
                              <span className="px-2.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-[10px] font-bold">
                                Non invité
                              </span>
                            )}
                            {!isKnownStatus && (
                              <span className="px-2.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-[10px] font-bold">
                                Statut invalide
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* Voir la Fiche */}
                              <button
                                onClick={() => {
                                  setSelectedTeacherForDossier(t.id);
                                  setDossierInitialMode('view');
                                  setShowTeacherDossierModal(true);
                                }}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg text-[10px] font-bold cursor-pointer transition-colors inline-flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Voir la fiche</span>
                              </button>

                              {/* Modifier */}
                              <button
                                onClick={() => {
                                  setSelectedTeacherForDossier(t.id);
                                  setDossierInitialMode('edit');
                                  setShowTeacherDossierModal(true);
                                }}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-[10px] font-bold cursor-pointer transition-colors inline-flex items-center gap-1"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Modifier</span>
                              </button>
                              {/* Invitation Action (STRICTEMENT SI status === 'not_invited') */}
                              {status === 'not_invited' && (
                                <button
                                  disabled={isInviting || !t.email}
                                  onClick={() => handleInviteTeacher(t)}
                                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 rounded-lg text-[10px] font-extrabold cursor-pointer transition-colors"
                                >
                                  {isInviting ? 'Envoi...' : 'Inviter à se connecter'}
                                </button>
                              )}

                              {status === 'invited' && (
                                <button
                                  disabled={true}
                                  title="Le renvoi sécurisé des invitations sera disponible après la configuration du service d’envoi d’emails."
                                  className="px-2.5 py-1 bg-indigo-900/40 text-indigo-400 border border-indigo-700/50 rounded-lg text-[10px] font-bold cursor-not-allowed transition-colors"
                                >
                                  Renvoyer l'invitation
                                </button>
                              )}

                              {/* Suspend / Reactivate Actions */}
                              {status === 'active' && (
                                <button
                                  disabled={isToggling}
                                  onClick={() => handleToggleTeacherStatus(t, 'suspend')}
                                  className="px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                                >
                                  {isToggling ? 'Suspension...' : 'Désactiver'}
                                </button>
                              )}

                              {status === 'suspended' && (
                                <button
                                  disabled={isToggling}
                                  onClick={() => handleToggleTeacherStatus(t, 'reactivate')}
                                  className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                                >
                                  {isToggling ? 'Réactivation...' : 'Réactiver'}
                                </button>
                              )}

                              {/* Consulter affectations */}
                              <button
                                onClick={() => {
                                  setAssignTeacherId(t.id);
                                  setShowAssignModal(true);
                                }}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-medium cursor-pointer"
                              >
                                Affectations
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB: PARENTS & RESPONSABLES */}
        {activeTab === 'parents' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-base text-white">Registre des Parents & Responsables Légaux</h3>
                <p className="text-xs text-slate-400">Gestion des liens parent-élève, permissions granulaires et invitations numériques</p>
              </div>
              <button
                onClick={() => {
                  setPFirstName('');
                  setPLastName('');
                  setPEmail('');
                  setPPhone('');
                  setPStudentIds([]);
                  setPRelationship('Père');
                  setPCanAcademic(true);
                  setPCanAttendance(true);
                  setPCanHomework(true);
                  setPCanFinances(true);
                  setPCanNotifications(true);
                  setPCanPickup(false);
                  setShowParentModal(true);
                }}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>Créer / Inviter un Responsable</span>
              </button>
            </div>

            {parents.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <Users className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucun responsable légal n'est encore enregistré ou invité.</p>
                <button
                  onClick={() => setShowParentModal(true)}
                  className="px-4 py-2 bg-emerald-500 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  Ajouter un Responsable
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Responsable</th>
                      <th className="p-3">Contact</th>
                      <th className="p-3">Élève(s) Rattaché(s)</th>
                      <th className="p-3">Permissions d'Accès</th>
                      <th className="p-3">Statut Compte</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {parents.map(p => {
                      return (
                        <tr key={p.parent_profile_id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="p-3">
                            <div className="font-extrabold text-white text-sm">
                              {p.first_name} {p.last_name}
                            </div>
                            <span className="text-[11px] text-slate-400 font-mono">ID: {p.parent_profile_id.slice(0, 8)}...</span>
                          </td>
                          <td className="p-3 space-y-0.5">
                            <div className="font-mono text-emerald-400 flex items-center gap-1">
                              <Mail className="w-3 h-3 text-slate-500" />
                              <span>{p.email || 'Non renseigné'}</span>
                            </div>
                            {p.phone && (
                              <div className="text-slate-400 text-[11px] flex items-center gap-1">
                                <Phone className="w-3 h-3 text-slate-500" />
                                <span>{p.phone}</span>
                              </div>
                            )}
                          </td>
                          <td className="p-3">
                            {p.linked_students && p.linked_students.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {p.linked_students.map(ls => (
                                  <div
                                    key={ls.link_id}
                                    className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-xl space-y-0.5"
                                  >
                                    <div className="flex items-center gap-1.5 font-bold text-white">
                                      <span>{ls.first_name} {ls.last_name}</span>
                                      {ls.class_name && (
                                        <span className="text-[10px] px-1.5 py-0.2 bg-indigo-500/20 text-indigo-300 rounded">
                                          {ls.class_name}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                      <span className="text-emerald-400 font-medium">{ls.relationship}</span>
                                      <span>•</span>
                                      <span className={ls.status === 'approved' ? 'text-emerald-400' : 'text-amber-400'}>
                                        {ls.status === 'approved' ? 'Approuvé' : ls.status}
                                      </span>
                                      <button
                                        onClick={() => {
                                          setSelectedParentForLink(p);
                                          setSelectedLinkToEdit(ls);
                                          setShowEditLinkModal(true);
                                        }}
                                        className="text-amber-400 hover:text-amber-300 underline cursor-pointer ml-1"
                                      >
                                        Modifier
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-amber-400 font-bold">Aucun enfant lié</span>
                            )}
                          </td>
                          <td className="p-3">
                            {p.linked_students && p.linked_students.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {p.linked_students[0].can_view_academic && (
                                  <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded text-[10px] font-bold">
                                    Notes
                                  </span>
                                )}
                                {p.linked_students[0].can_view_attendance && (
                                  <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold">
                                    Présences
                                  </span>
                                )}
                                {p.linked_students[0].can_view_homework && (
                                  <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded text-[10px] font-bold">
                                    Devoirs
                                  </span>
                                )}
                                {p.linked_students[0].can_view_finances && (
                                  <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold">
                                    Finances
                                  </span>
                                )}
                                {p.linked_students[0].can_pickup_student && (
                                  <span className="px-1.5 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/30 rounded text-[10px] font-bold">
                                    Récupération
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="p-3">
                            {p.is_active ? (
                              <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Actif</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>Invité (En attente)</span>
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                            {!p.is_active && (
                              <button
                                onClick={() => handleReinviteParent(p)}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs"
                                title="Renvoyer l'invitation"
                              >
                                <Send className="w-3 h-3" />
                                <span>Renvoyer</span>
                              </button>
                            )}

                            <button
                              disabled={togglingParentId === p.parent_profile_id}
                              onClick={() => handleToggleParentStatus(p, p.is_active ? 'suspend' : 'reactivate')}
                              className={`px-2.5 py-1 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs border ${
                                p.is_active
                                  ? 'bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border-rose-800'
                                  : 'bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 border-emerald-800'
                              }`}
                            >
                              {p.is_active ? 'Suspendre' : 'Réactiver'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 8: ÉLÈVES */}
        {activeTab === 'eleves' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-base text-white">Registre des Élèves</h3>
                <p className="text-xs text-slate-400">Préenregistrement des élèves, inscriptions annuelles et gestion des comptes numériques</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setImportType('students');
                    setShowImportModal(true);
                  }}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Importer CSV/XLSX</span>
                </button>

                <button
                  onClick={() => setShowStudentModal(true)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Préenregistrer un Élève</span>
                </button>
              </div>
            </div>

            {/* Banner: Élèves Sans Classe */}
            {(() => {
              const unassignedList = students.filter(s => {
                const activeEnr = enrollments.find(e => e.student_id === s.id && e.status === 'active');
                return !activeEnr && !s.class_id;
              });

              if (unassignedList.length === 0) return null;

              return (
                <div className="p-4 bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-300">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-extrabold text-amber-200">{unassignedList.length} Élève(s) sans classe affectée</h4>
                      <p className="mt-0.5 text-slate-300">
                        Ces élèves sont enregistrés mais n'ont pas encore d'inscription scolaire active dans une classe.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedClassFilterId('unassigned')}
                    className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl cursor-pointer shrink-0 transition-colors"
                  >
                    Voir les élèves sans classe
                  </button>
                </div>
              );
            })()}

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-2 p-2 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
              <span className="text-slate-400 font-bold px-2 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" />
                <span>Filtrer par Classe :</span>
              </span>
              <button
                onClick={() => setSelectedClassFilterId(null)}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                  selectedClassFilterId === null
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                }`}
              >
                Toutes ({students.length})
              </button>
              {classes.map(c => {
                const count = enrollments.filter(e => e.class_id === c.id && e.status === 'active').length || students.filter(st => st.class_id === c.id).length;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedClassFilterId(c.id)}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                      selectedClassFilterId === c.id
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    {c.name} ({count})
                  </button>
                );
              })}
              {(() => {
                const unassignedCount = students.filter(s => {
                  const activeEnr = enrollments.find(e => e.student_id === s.id && e.status === 'active');
                  return !activeEnr && !s.class_id;
                }).length;
                if (unassignedCount === 0) return null;
                return (
                  <button
                    onClick={() => setSelectedClassFilterId('unassigned')}
                    className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                      selectedClassFilterId === 'unassigned'
                        ? 'bg-rose-600 text-white shadow-md'
                        : 'bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border border-rose-800'
                    }`}
                  >
                    Sans Classe ({unassignedCount})
                  </button>
                );
              })()}
            </div>

            {students.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <GraduationCap className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucun élève n'est encore préenregistré.</p>
                <div className="flex justify-center gap-2 pt-1">
                  <button
                    onClick={() => setShowStudentModal(true)}
                    className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl cursor-pointer"
                  >
                    Ajout Manuel
                  </button>
                  <button
                    onClick={() => {
                      setImportType('students');
                      setShowImportModal(true);
                    }}
                    className="px-4 py-2 bg-slate-800 border border-slate-700 text-white font-bold rounded-xl cursor-pointer"
                  >
                    Importer CSV
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Matricule</th>
                      <th className="p-3">Nom & Prénom</th>
                      <th className="p-3">Classe Actuelle</th>
                      <th className="p-3">Compte Numérique</th>
                      <th className="p-3">Statut Inscription</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {students
                      .filter(s => {
                        if (!selectedClassFilterId) return true;
                        const activeEnr = enrollments.find(e => e.student_id === s.id && e.status === 'active');
                        if (selectedClassFilterId === 'unassigned') {
                          return !activeEnr && !s.class_id;
                        }
                        return activeEnr?.class_id === selectedClassFilterId || s.class_id === selectedClassFilterId;
                      })
                      .map(s => {
                        const activeEnr = enrollments.find(e => e.student_id === s.id && e.status === 'active');
                        const currentClass = classes.find(c => c.id === (activeEnr?.class_id || s.class_id));

                        return (
                          <tr key={s.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-3 font-mono font-bold text-amber-400">{s.student_number}</td>
                            <td className="p-3">
                              <div className="font-extrabold text-white text-sm">
                                {s.first_name} {s.last_name} {s.middle_name ? `(${s.middle_name})` : ''}
                              </div>
                              {s.email && <div className="text-[11px] text-slate-400 font-mono">{s.email}</div>}
                            </td>
                            <td className="p-3">
                              {currentClass ? (
                                <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl font-bold inline-flex items-center gap-1">
                                  <BookOpen className="w-3 h-3" />
                                  <span>{currentClass.name}</span>
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl font-bold inline-flex items-center gap-1">
                                  <UserX className="w-3 h-3" />
                                  <span>Sans classe</span>
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              {s.account_status === 'active' ? (
                                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Actif</span>
                                </span>
                              ) : s.account_status === 'invited' ? (
                                <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  <span>Invité</span>
                                </span>
                              ) : s.account_status === 'suspended' ? (
                                <span className="px-2.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full text-[10px] font-bold">
                                  Suspendu
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-[10px] font-bold">
                                  Non invité
                                </span>
                              )}
                            </td>
                            <td className="p-3">
                              {activeEnr ? (
                                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Inscrit ({activeEnr.status})</span>
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full text-[10px] font-bold">
                                  Non inscrit
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                              {/* Voir la Fiche */}
                              <button
                                onClick={() => {
                                  setSelectedStudentForDossier(s.id);
                                  setDossierInitialMode('view');
                                  setShowStudentDossierModal(true);
                                }}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-amber-500/20 text-amber-300 border border-slate-700 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Voir la fiche</span>
                              </button>

                              {/* Modifier */}
                              <button
                                onClick={() => {
                                  setSelectedStudentForDossier(s.id);
                                  setDossierInitialMode('edit');
                                  setShowStudentDossierModal(true);
                                }}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>Modifier</span>
                              </button>
                              <button
                                onClick={() => openChangeClassModal(s)}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-indigo-600/30 text-indigo-300 hover:text-indigo-200 border border-slate-700 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs"
                              >
                                <ArrowRightLeft className="w-3 h-3" />
                                <span>{currentClass ? 'Changer classe' : 'Affecter'}</span>
                              </button>

                              {s.account_status === 'not_invited' && (
                                <button
                                  onClick={() => handleOpenStudentInviteModal(s)}
                                  className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs"
                                >
                                  <Mail className="w-3 h-3" />
                                  <span>Inviter</span>
                                </button>
                              )}

                              {s.account_status === 'invited' && (
                                <button
                                  onClick={() => handleReinviteStudent(s)}
                                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Renvoyer</span>
                                </button>
                              )}

                              {(s.account_status === 'active' || s.account_status === 'suspended') && (
                                <button
                                  disabled={togglingStudentId === s.id}
                                  onClick={() => handleToggleStudentStatus(s, s.account_status === 'active' ? 'suspend' : 'reactivate')}
                                  className={`px-2.5 py-1 rounded-xl font-bold transition-all cursor-pointer inline-flex items-center gap-1 text-xs border ${
                                    s.account_status === 'active'
                                      ? 'bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 border-rose-800'
                                      : 'bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/60 border-emerald-800'
                                  }`}
                                >
                                  {s.account_status === 'active' ? 'Suspendre' : 'Réactiver'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB: EMPLOI DU TEMPS */}
        {activeTab === 'emploi_du_temps' && (
          <SchoolTimetableManagement
            schoolId={school?.id || ''}
            academicYears={academicYears.map(ay => ({
              id: ay.id,
              name: ay.name,
              is_current: ay.is_current
            }))}
            classes={classes.map(c => ({
              id: c.id,
              name: c.name
            }))}
            subjects={subjects.map(s => ({
              id: s.id,
              name: s.name,
              code: s.code
            }))}
            teachers={teachers.map(t => ({
              id: t.id,
              first_name: t.first_name,
              last_name: t.last_name,
              speciality: t.speciality
            }))}
          />
        )}

        {/* TAB: DOCUMENTS SCOLAIRES */}
        {activeTab === 'documents' && (
          <AdminSchoolDocumentsModule
            classes={classes.map(c => ({ id: c.id, name: c.name }))}
            students={students.map(s => ({
              id: s.id,
              first_name: s.first_name,
              last_name: s.last_name,
              class_id: s.class_id,
              student_number: s.student_number
            }))}
            onShowToast={(msg, type) => showToast(msg, type === 'error' ? 'urgent' : (type as any))}
          />
        )}

        {/* TAB: PRÉSENCES */}
        {activeTab === 'presences' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-extrabold text-base text-white">Gestion Opérationnelle des Présences</h3>
                <p className="text-xs text-slate-400">Suivi des appels journaliers, statistiques de présence et registre d'audit des séances</p>
              </div>
              <button
                onClick={() => {
                  if (classes.length > 0) setNewSessionClassId(classes[0].id);
                  if (subjects.length > 0) setNewSessionSubjectId(subjects[0].id);
                  setShowNewSessionModal(true);
                }}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Nouvelle Séance d'Appel</span>
              </button>
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-bold">Séances Enregistrées</span>
                <p className="text-xl font-black text-white">{attendanceSessions.length}</p>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-bold">Séances Finalisées</span>
                <p className="text-xl font-black text-emerald-400">
                  {attendanceSessions.filter(s => s.status === 'completed').length}
                </p>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-bold">Total Absences</span>
                <p className="text-xl font-black text-rose-400">
                  {studentAttendanceRecords.filter(r => r.status === 'absent').length}
                </p>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-slate-400 font-bold">Total Retards</span>
                <p className="text-xl font-black text-amber-400">
                  {studentAttendanceRecords.filter(r => r.status === 'late').length}
                </p>
              </div>
            </div>

            {/* Attendance Sessions Table */}
            {attendanceSessions.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <CalendarCheck className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucune séance d'appel n'a encore été créée pour cet établissement.</p>
                <button
                  onClick={() => {
                    if (classes.length > 0) setNewSessionClassId(classes[0].id);
                    setShowNewSessionModal(true);
                  }}
                  className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl cursor-pointer"
                >
                  Créer la première séance d'appel
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Date</th>
                      <th className="p-3">Classe</th>
                      <th className="p-3">Matière</th>
                      <th className="p-3">Présences / Statuts</th>
                      <th className="p-3">Statut Séance</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {attendanceSessions.map(sess => {
                      const sessionClass = classes.find(c => c.id === sess.class_id);
                      const sessionSubject = subjects.find(s => s.id === sess.subject_id);
                      const records = studentAttendanceRecords.filter(sa => sa.attendance_session_id === sess.id);

                      const presentCount = records.filter(r => r.status === 'present').length;
                      const absentCount = records.filter(r => r.status === 'absent').length;
                      const lateCount = records.filter(r => r.status === 'late').length;
                      const excusedCount = records.filter(r => r.status === 'excused').length;

                      return (
                        <tr key={sess.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="p-3 font-mono font-bold text-amber-400">
                            {new Date(sess.attendance_date).toLocaleDateString('fr-FR')}
                          </td>
                          <td className="p-3 font-extrabold text-white">
                            {sessionClass ? sessionClass.name : 'Classe supprimée'}
                          </td>
                          <td className="p-3 text-slate-300">
                            {sessionSubject ? sessionSubject.name : 'Toutes matières / Appel général'}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 font-bold text-[11px]">
                              <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg">
                                {presentCount} Prés.
                              </span>
                              {absentCount > 0 && (
                                <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg">
                                  {absentCount} Abs.
                                </span>
                              )}
                              {lateCount > 0 && (
                                <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg">
                                  {lateCount} Ret.
                                </span>
                              )}
                              {excusedCount > 0 && (
                                <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-lg">
                                  {excusedCount} Exc.
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            {sess.status === 'completed' && (
                              <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-bold text-[10px] inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Finalisée</span>
                              </span>
                            )}
                            {sess.status === 'draft' && (
                              <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-bold text-[10px] inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>Brouillon</span>
                              </span>
                            )}
                            {sess.status === 'reopened' && (
                              <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full font-bold text-[10px] inline-flex items-center gap-1">
                                <RotateCcw className="w-3 h-3" />
                                <span>Rouverte</span>
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => openTakeAttendanceSheet(sess)}
                                className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl cursor-pointer transition-colors text-xs"
                              >
                                {sess.status === 'completed' ? 'Consulter / Corriger' : 'Faire l\'appel'}
                              </button>

                              {sess.status === 'completed' && (
                                <button
                                  onClick={() => {
                                    setSelectedSession(sess);
                                    setReopenReasonText('');
                                    setShowReopenModal(true);
                                  }}
                                  title="Rouvrir cette séance terminée (School-Admin uniquement)"
                                  className="p-1.5 bg-slate-800 hover:bg-indigo-600/30 text-indigo-300 hover:text-indigo-200 rounded-lg transition-colors cursor-pointer"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 8: AFFECTATIONS */}
        {activeTab === 'affectations' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Affectations des Enseignants</h3>
                <p className="text-xs text-slate-400">Matrice de correspondance Enseignant ➔ Matière ➔ Classe</p>
              </div>
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Créer une Affectation</span>
              </button>
            </div>

            {(() => {
              // 1. Lignes Titularisation Primaire (dérivées exclusivement de classes.homeroom_teacher_id)
              const primaryClasses = classes.filter(c => c.pedagogical_mode === 'primary_homeroom');
              const primaryRows = primaryClasses.map(cls => {
                const homeroomTeacher = teachers.find(t => t.profile_id === cls.homeroom_teacher_id || t.id === cls.homeroom_teacher_id);
                return {
                  id: `primary-${cls.id}`,
                  class_id: cls.id,
                  class_name: cls.name,
                  teacher_name: homeroomTeacher ? `${homeroomTeacher.first_name} ${homeroomTeacher.last_name}` : 'Aucun titulaire affecté',
                  subject_name: 'Titulaire — Toutes les matières',
                  mode: 'primary_homeroom' as const
                };
              });

              // 2. Lignes Secondaire (dérivées de teacher_class_assignments, en ignorant les anciennes lignes d'une classe primaire)
              const secondaryAssignments = assignments.filter(a => {
                const cls = classes.find(c => c.id === a.class_id);
                return cls ? cls.pedagogical_mode !== 'primary_homeroom' : true;
              });

              const secondaryRows = secondaryAssignments.map(a => {
                const tch = teachers.find(t => t.id === a.teacher_id);
                const cls = classes.find(c => c.id === a.class_id);
                return {
                  id: a.id,
                  class_id: a.class_id,
                  class_name: cls ? cls.name : 'Classe Rattachée',
                  teacher_name: tch ? `${tch.first_name} ${tch.last_name}` : 'Enseignant Rattaché',
                  subject_name: a.subject_name,
                  mode: 'secondary_subjects' as const
                };
              });

              const displayRows = [...primaryRows, ...secondaryRows];

              if (displayRows.length === 0) {
                return (
                  <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                    <Layers className="w-10 h-10 text-slate-600 mx-auto" />
                    <p className="font-bold text-slate-300">Aucune affectation n'est encore configurée.</p>
                    <button
                      onClick={() => setShowAssignModal(true)}
                      className="px-4 py-2 bg-amber-500 text-slate-950 font-black rounded-xl cursor-pointer"
                    >
                      Créer la première affectation
                    </button>
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800 text-[10px]">
                        <th className="p-3">Enseignant</th>
                        <th className="p-3">Matière Enseignée</th>
                        <th className="p-3">Classe</th>
                        <th className="p-3 text-center">Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {displayRows.map(row => (
                        <tr key={row.id}>
                          <td className="p-3 font-bold text-white">{row.teacher_name}</td>
                          <td className="p-3 font-extrabold text-amber-400">{row.subject_name}</td>
                          <td className="p-3 text-slate-300">{row.class_name}</td>
                          <td className="p-3 text-center">
                            {row.mode === 'primary_homeroom' ? (
                              <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-[10px] font-bold">
                                Primaire
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full text-[10px] font-bold">
                                Secondaire
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 9: IMPORTATIONS */}
        {activeTab === 'importations' && (
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-base text-white">Centre d'Importation CSV / XLSX</h3>
                <p className="text-xs text-slate-400">Importation guidée en masse sans création prématurée d'utilisateurs Auth</p>
              </div>
              <div className="flex gap-2">
                <a
                  href="/templates/modele_enseignants.csv"
                  download
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Modèle Enseignants CSV</span>
                </a>
                <a
                  href="/templates/modele_eleves.csv"
                  download
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Modèle Élèves CSV</span>
                </a>
              </div>
            </div>

            {importJobs.length === 0 ? (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 space-y-3 text-xs">
                <Upload className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="font-bold text-slate-300">Aucun historique d'importation enregistré.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 font-bold uppercase border-b border-slate-800">
                      <th className="p-3">Date</th>
                      <th className="p-3">Type</th>
                      <th className="p-3">Fichier</th>
                      <th className="p-3">Lignes Valides</th>
                      <th className="p-3">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {importJobs.map(j => (
                      <tr key={j.id}>
                        <td className="p-3 font-mono text-slate-400">{new Date(j.created_at).toLocaleString('fr-FR')}</td>
                        <td className="p-3 font-extrabold uppercase text-amber-400">{j.import_type}</td>
                        <td className="p-3 text-slate-300">{j.file_name || 'N/A'}</td>
                        <td className="p-3 font-bold text-white">{j.valid_rows} / {j.total_rows}</td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full text-[10px] font-bold">
                            {j.status}
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

        {/* TAB 10: PARAMÈTRES & IDENTITÉ OFFICIELLE */}
        {activeTab === 'parametres' && (
          <SchoolOfficialIdentityModule />
        )}

        {/* TAB: SUPERVISION DES DEVOIRS */}
        {activeTab === 'devoirs' && (
          <div className="space-y-6">
            {/* Header Devoirs Admin */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl">
              <div>
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  <FileText className="w-6 h-6 text-amber-400" />
                  <span>Supervision Administrative des Devoirs</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Consultez et supervisez tous les devoirs créés par les enseignants de votre établissement.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold">
                  Total : {adminHomeworkList.length}
                </span>
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold">
                  Publiés : {adminHomeworkList.filter(h => h.status === 'published').length}
                </span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800 text-xs">
              <div className="flex items-center gap-1.5 text-slate-400 font-bold mr-2">
                <Filter className="w-4 h-4 text-amber-400" />
                <span>Filtres :</span>
              </div>

              {/* Filtre Enseignant */}
              <select
                value={adminHwTeacherFilter}
                onChange={e => setAdminHwTeacherFilter(e.target.value)}
                className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="all">Tous les enseignants ({teachers.length})</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
                ))}
              </select>

              {/* Filtre Classe */}
              <select
                value={adminHwClassFilter}
                onChange={e => setAdminHwClassFilter(e.target.value)}
                className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="all">Toutes les classes ({classes.length})</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              {/* Filtre Matière */}
              <select
                value={adminHwSubjectFilter}
                onChange={e => setAdminHwSubjectFilter(e.target.value)}
                className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="all">Toutes les matières ({subjects.length})</option>
                {subjects.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>

              {/* Filtre Statut */}
              <select
                value={adminHwStatusFilter}
                onChange={e => setAdminHwStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-800 text-white rounded-xl border border-slate-700 text-xs font-medium focus:outline-none focus:border-amber-500"
              >
                <option value="all">Tous les statuts</option>
                <option value="draft">Brouillons</option>
                <option value="published">Publiés</option>
                <option value="closed">Clôturés</option>
                <option value="cancelled">Annulés</option>
              </select>
            </div>

            {/* Table Devoirs */}
            {(() => {
              const filteredList = adminHomeworkList.filter(hw => {
                if (adminHwTeacherFilter !== 'all' && hw.teacher_id !== adminHwTeacherFilter) return false;
                if (adminHwClassFilter !== 'all' && hw.class_id !== adminHwClassFilter) return false;
                if (adminHwSubjectFilter !== 'all' && hw.subject_id !== adminHwSubjectFilter) return false;
                if (adminHwStatusFilter !== 'all' && hw.status !== adminHwStatusFilter) return false;
                return true;
              });

              if (filteredList.length === 0) {
                return (
                  <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
                    <FileText className="w-12 h-12 text-slate-600 mx-auto" />
                    <p className="text-sm font-bold text-slate-300">Aucun devoir enregistré</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Aucun devoir ne correspond à vos filtres ou aucun enseignant n'a encore enregistré de devoir.
                    </p>
                  </div>
                );
              }

              return (
                <div className="bg-slate-900 rounded-3xl border border-slate-800 overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider font-extrabold text-[10px]">
                          <th className="p-4">Enseignant</th>
                          <th className="p-4">Classe & Matière</th>
                          <th className="p-4">Titre du Devoir</th>
                          <th className="p-4">Échéance</th>
                          <th className="p-4 text-center">Statut</th>
                          <th className="p-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-medium">
                        {filteredList.map(hw => {
                          const isOverdue = hw.status === 'published' && new Date(hw.due_at) < new Date();
                          return (
                            <tr key={hw.id} className="hover:bg-slate-800/40 transition-colors">
                              <td className="p-4">
                                <span className="font-extrabold text-white block">{hw.teacher_name}</span>
                              </td>
                              <td className="p-4">
                                <span className="text-amber-300 font-bold block">{hw.class_name}</span>
                                <span className="text-slate-400 text-[10px] block">{hw.subject_name}</span>
                              </td>
                              <td className="p-4 max-w-xs">
                                <span className="font-bold text-white block truncate">{hw.title}</span>
                                <span className="text-slate-400 text-[10px] block truncate">{hw.instructions}</span>
                              </td>
                              <td className="p-4 whitespace-nowrap">
                                <span className={`font-bold block ${isOverdue ? 'text-rose-400' : 'text-slate-200'}`}>
                                  {new Date(hw.due_at).toLocaleDateString('fr-FR')}
                                </span>
                                <span className="text-slate-500 text-[10px] block">
                                  à {new Date(hw.due_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </td>
                              <td className="p-4 text-center whitespace-nowrap">
                                {hw.status === 'draft' && (
                                  <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-[10px] font-bold">
                                    Brouillon
                                  </span>
                                )}
                                {hw.status === 'published' && !isOverdue && (
                                  <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg text-[10px] font-bold">
                                    Publié
                                  </span>
                                )}
                                {hw.status === 'published' && isOverdue && (
                                  <span className="px-2.5 py-1 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-lg text-[10px] font-black animate-pulse">
                                    En retard
                                  </span>
                                )}
                                {hw.status === 'closed' && (
                                  <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-lg text-[10px] font-bold">
                                    Clôturé
                                  </span>
                                )}
                                {hw.status === 'cancelled' && (
                                  <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-lg text-[10px] font-bold">
                                    Annulé
                                  </span>
                                )}
                              </td>
                              <td className="p-4 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      setSelectedAdminHw(hw);
                                      setShowAdminHwDetailModal(true);
                                    }}
                                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
                                  >
                                    Détails
                                  </button>
                                  {hw.status !== 'cancelled' && (
                                    <button
                                      onClick={() => {
                                        setSelectedAdminHw(hw);
                                        setAdminCancelReason('');
                                        setShowAdminHwCancelModal(true);
                                      }}
                                      className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                                    >
                                      Annuler
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB: COEFFICIENTS DES MATIÈRES */}
        {activeTab === 'coefficients' && (
          <ClassSubjectCoefficientsModule
            classes={classes}
            subjects={subjects}
            academicYears={academicYears}
          />
        )}

        {/* TAB: NOTES & ÉVALUATIONS */}
        {activeTab === 'notes' && (
          <AdminGradesModule
            teachers={teachers}
            classes={classes}
            subjects={subjects}
            schoolTerms={schoolTerms}
            schoolPeriods={schoolPeriods}
            onStatsChange={count => setAdminAssessmentsCount(count)}
          />
        )}
          </>
        )}
      </main>

      {/* Modal: Créer une Année Scolaire */}
      <Modal
        isOpen={showYearModal}
        onClose={() => setShowYearModal(false)}
        title="Créer une Année Scolaire"
        darkMode={true}
      >
        <form onSubmit={handleCreateYear} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Libellé (ex: 2026–2027) *</label>
            <input
              type="text"
              required
              value={yearName}
              onChange={e => setYearName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
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
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date Fin *</label>
              <input
                type="date"
                required
                value={yearEndsOn}
                onChange={e => setYearEndsOn(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={yearIsCurrent}
              onChange={e => setYearIsCurrent(e.target.checked)}
              className="w-4 h-4 rounded text-amber-500 bg-slate-950 border-2 border-slate-600"
            />
            <span className="text-xs font-bold text-slate-200">Définir comme année courante active</span>
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => setShowYearModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black">Créer l'Année</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Créer un Trimestre */}
      <Modal
        isOpen={showTermModal}
        onClose={() => setShowTermModal(false)}
        title="Créer un Trimestre"
        darkMode={true}
      >
        <form onSubmit={handleCreateTerm} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Intitulé *</label>
            <input
              type="text"
              required
              value={termName}
              onChange={e => setTermName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Position (1, 2, 3) *</label>
              <input
                type="number"
                min="1"
                max="6"
                value={termPosition}
                onChange={e => setTermPosition(parseInt(e.target.value) || 1)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Année Scolaire *</label>
              <select
                value={termYearId}
                onChange={e => setTermYearId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              >
                {academicYears.map(y => <option key={y.id} value={y.id} className="bg-slate-900 text-white">{y.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date Début (Facultative)</label>
              <input
                type="date"
                value={termStartsOn}
                onChange={e => setTermStartsOn(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Date Fin (Facultative)</label>
              <input
                type="date"
                value={termEndsOn}
                onChange={e => setTermEndsOn(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => setShowTermModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black">Enregistrer Trimestre</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Créer une Matière */}
      <Modal
        isOpen={showSubjectModal}
        onClose={() => setShowSubjectModal(false)}
        title="Créer une Matière"
        darkMode={true}
      >
        <form onSubmit={handleCreateSubject} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Intitulé de la Matière *</label>
            <input
              type="text"
              required
              placeholder="Ex: Mathématiques"
              value={subjectName}
              onChange={e => setSubjectName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Code (ex: MATH)</label>
            <input
              type="text"
              placeholder="MATH"
              value={subjectCode}
              onChange={e => setSubjectCode(e.target.value.toUpperCase())}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-mono text-amber-300 font-bold focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Description (Facultative)</label>
            <input
              type="text"
              placeholder="Description du programme..."
              value={subjectDesc}
              onChange={e => setSubjectDesc(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => setShowSubjectModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black">Créer Matière</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Créer une Classe */}
      <Modal
        isOpen={showClassModal}
        onClose={() => setShowClassModal(false)}
        title="Créer une Nouvelle Classe"
        darkMode={true}
      >
        <form onSubmit={handleCreateClass} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nom de la Classe *</label>
            <input
              type="text"
              required
              placeholder="Ex: 7ème EB - A"
              value={className}
              onChange={e => setClassName(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Cycle Scolaire</label>
            <select
              value={classCycle}
              onChange={e => setClassCycle(e.target.value as 'primary' | 'secondary' | '')}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
            >
              <option value="" className="bg-slate-900 text-slate-400">-- Non défini pour le moment --</option>
              {(!school?.education_cycles || school.education_cycles.includes('primary')) && (
                <option value="primary" className="bg-slate-900 text-white">Primaire (3 Trimestres / 9 Périodes)</option>
              )}
              {(!school?.education_cycles || school.education_cycles.includes('secondary')) && (
                <option value="secondary" className="bg-slate-900 text-white">Secondaire (2 Semestres / 4 Périodes)</option>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Mode Pédagogique *</label>
            <select
              value={classPedagogicalMode}
              onChange={e => setClassPedagogicalMode(e.target.value as 'primary_homeroom' | 'secondary_subjects')}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
            >
              <option value="secondary_subjects" className="bg-slate-900 text-white">Secondaire — Enseignants affectés par matière</option>
              <option value="primary_homeroom" className="bg-slate-900 text-white">Primaire — Titulaire enseigne toutes les matières</option>
            </select>
            <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
              En mode Primaire, l'enseignant titulaire désigné aura automatiquement l'autorisation pédagogique sur toutes les matières configurées de la classe.
            </p>
          </div>


          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Niveau</label>
              <input type="text" value={classLevel} onChange={e => setClassLevel(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white" />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Section</label>
              <input type="text" value={classSection} onChange={e => setClassSection(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white" />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Salle</label>
              <input type="text" value={classRoom} onChange={e => setClassRoom(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Enseignant Titulaire (Facultatif)</label>
            <select value={classTeacherId} onChange={e => setClassTeacherId(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500">
              <option value="" className="bg-slate-900 text-slate-400">-- Aucun titulaire pour le moment --</option>
              {teachers.map(t => <option key={t.id} value={t.id} className="bg-slate-900 text-white">{t.first_name} {t.last_name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => setShowClassModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black">Créer Classe</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Définir / Modifier le Cycle d'une Classe (Auditée) */}
      {showSetCycleModal && selectedClassForCycle && (
        <Modal
          isOpen={showSetCycleModal}
          onClose={() => setShowSetCycleModal(false)}
          title={`Cycle Scolaire : ${selectedClassForCycle.name}`}
          darkMode={true}
        >
          <form onSubmit={handleSetClassCycle} className="space-y-4 text-xs">
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 text-[11px]">
              La modification du cycle scolaire d'une classe adapte automatiquement son calendrier d'évaluation (3 trimestres/9 périodes pour le primaire, 2 semestres/4 périodes pour le secondaire).
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Cycle Scolaire *</label>
              <select
                value={targetCycleForChange}
                onChange={e => setTargetCycleForChange(e.target.value as 'primary' | 'secondary' | '')}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
              >
                <option value="" className="bg-slate-900 text-slate-400">-- Non défini --</option>
                {(!school?.education_cycles || school.education_cycles.includes('primary')) && (
                  <option value="primary" className="bg-slate-900 text-white">Primaire (3 Trimestres / 9 Périodes)</option>
                )}
                {(!school?.education_cycles || school.education_cycles.includes('secondary')) && (
                  <option value="secondary" className="bg-slate-900 text-white">Secondaire (2 Semestres / 4 Périodes)</option>
                )}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowSetCycleModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={settingCycle}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black disabled:opacity-50"
              >
                {settingCycle ? 'Enregistrement...' : 'Enregistrer le Cycle'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Définir / Modifier le Mode Pédagogique d'une Classe (Auditée) */}
      {showPedagogicalModeModal && selectedClassForMode && (
        <Modal
          isOpen={showPedagogicalModeModal}
          onClose={() => setShowPedagogicalModeModal(false)}
          title={`Mode Pédagogique : ${selectedClassForMode.name}`}
          darkMode={true}
        >
          <form onSubmit={handleSetPedagogicalMode} className="space-y-4 text-xs">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 space-y-1.5">
              <div className="font-extrabold flex items-center gap-1.5 text-xs">
                <Info className="w-4 h-4 text-amber-400" />
                <span>Explication du Mode Pédagogique</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-300/90">
                • <strong>Primaire — Titulaire enseigne toutes les matières</strong> : L’enseignant titulaire désigné aura automatiquement l’autorisation pédagogique (devoirs, notes) sur toutes les matières configurées pour cette classe.<br />
                • <strong>Secondaire — Enseignants affectés par matière</strong> : Les autorisations pédagogiques proviennent exclusivement des affectations individuelles enseignant–classe–matière.
              </p>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-2">
                Sélectionner le mode pédagogique
              </label>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  targetPedagogicalMode === 'primary_homeroom'
                    ? 'bg-amber-500/10 border-amber-500 text-white'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}>
                  <input
                    type="radio"
                    name="pedagogicalMode"
                    value="primary_homeroom"
                    checked={targetPedagogicalMode === 'primary_homeroom'}
                    onChange={() => setTargetPedagogicalMode('primary_homeroom')}
                    className="mt-0.5 text-amber-500 focus:ring-amber-500"
                  />
                  <div>
                    <div className="font-extrabold text-xs text-amber-400">Primaire — Titulaire enseigne toutes les matières</div>
                    <div className="text-[11px] text-slate-400">Accès global du titulaire à toutes les matières configurées.</div>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  targetPedagogicalMode === 'secondary_subjects'
                    ? 'bg-purple-500/10 border-purple-500 text-white'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}>
                  <input
                    type="radio"
                    name="pedagogicalMode"
                    value="secondary_subjects"
                    checked={targetPedagogicalMode === 'secondary_subjects'}
                    onChange={() => setTargetPedagogicalMode('secondary_subjects')}
                    className="mt-0.5 text-purple-500 focus:ring-purple-500"
                  />
                  <div>
                    <div className="font-extrabold text-xs text-purple-400">Secondaire — Enseignants affectés par matière</div>
                    <div className="text-[11px] text-slate-400">Accès strictement basé sur les affectations enseignant-matière.</div>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowPedagogicalModeModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingPedagogicalMode}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl font-black transition-colors disabled:opacity-50"
              >
                {savingPedagogicalMode ? 'Enregistrement...' : 'Enregistrer le Mode'}
              </button>
            </div>
          </form>
        </Modal>
      )}


      {/* Modal: Configuration du Calendrier RDC (Primaire ou Secondaire) */}
      {showDrcConfigModal && (
        <Modal
          isOpen={showDrcConfigModal}
          onClose={() => setShowDrcConfigModal(false)}
          title={`Configuration du Calendrier RDC — Cycle ${drcConfigCycle === 'primary' ? 'Primaire' : 'Secondaire'}`}
          darkMode={true}
        >
          <form onSubmit={handleConfigureDrcCalendar} className="space-y-4 text-xs">
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
              <p className="font-extrabold text-white text-sm">
                Structure générée pour l'année {currentYearObj?.name} :
              </p>
              {drcConfigCycle === 'primary' ? (
                <ul className="list-disc list-inside space-y-1 text-slate-300 text-xs">
                  <li><strong>3 Trimestres</strong> (1er Trimestre, 2e Trimestre, 3e Trimestre)</li>
                  <li><strong>9 Périodes</strong> (1re à 9e Période, réparties 3 par trimestre)</li>
                </ul>
              ) : (
                <ul className="list-disc list-inside space-y-1 text-slate-300 text-xs">
                  <li><strong>2 Semestres</strong> (1er Semestre, 2e Semestre)</li>
                  <li><strong>4 Périodes</strong> (1re à 4e Période, réparties 2 par semestre)</li>
                </ul>
              )}
            </div>

            {drcConfigCycle === 'primary' && schoolTerms.filter(t => !t.education_cycle).length === 3 && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="adoptLegacy"
                  checked={drcAdoptLegacy}
                  onChange={e => setDrcAdoptLegacy(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded mt-0.5 cursor-pointer"
                />
                <label htmlFor="adoptLegacy" className="text-amber-300 text-[11px] cursor-pointer">
                  <strong>Adopter les 3 trimestres existants</strong> déjà configurés dans l'établissement pour ce cycle sans créer de doublons.
                </label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowDrcConfigModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={configuringDrc}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black disabled:opacity-50 cursor-pointer"
              >
                {configuringDrc ? 'Génération...' : 'Confirmer et Générer'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Modifier les Dates d'un Terme (Trimestre / Semestre) */}
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
                Année scolaire : <strong className="text-white">{currentYearObj?.name}</strong> ({currentYearObj?.starts_on} au {currentYearObj?.ends_on})
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
                  min={currentYearObj?.starts_on}
                  max={currentYearObj?.ends_on}
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
                  min={termStartInput || currentYearObj?.starts_on}
                  max={currentYearObj?.ends_on}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Validation en temps réel */}
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

      {/* Modal: Modifier les Dates d'une Période */}
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

            {/* Validation en temps réel */}
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

      {/* Modal: Erreurs de Configuration du Calendrier */}
      {showConfigErrorsModal && (
        <Modal
          isOpen={showConfigErrorsModal}
          onClose={() => setShowConfigErrorsModal(false)}
          title={`Validation du Calendrier Scolaire — ${configErrorsCycle === 'primary' ? 'Cycle Primaire' : 'Cycle Secondaire'}`}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300">
              Pour activer et publier ce Calendrier Scolaire, tous les éléments suivants doivent être dûment complétés et cohérents :
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

      {/* Modal: Rouvrir le Calendrier Scolaire en Brouillon */}
      {showReopenCalendarModal && (
        <Modal
          isOpen={showReopenCalendarModal}
          onClose={() => setShowReopenCalendarModal(false)}
          title={`Réouverture du Calendrier — ${reopenCalendarCycle === 'primary' ? 'Cycle Primaire' : 'Cycle Secondaire'}`}
          darkMode={true}
        >
          <form onSubmit={handleConfirmReopenCalendar} className="space-y-4 text-xs">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 space-y-1">
              <p className="font-extrabold text-white">Attention : Passage en mode Brouillon</p>
              <p className="text-[11px] leading-relaxed">
                La réouverture repasse le calendrier en statut <code>draft</code> pour vous permettre de rectifier les dates de trimestres, semestres et périodes. Un motif explicite est requis pour le journal d'audit.
              </p>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Motif de réouverture (minimum 5 caractères) *
              </label>
              <textarea
                required
                rows={3}
                placeholder="Ex: Rectification des dates de fin du 2e trimestre suite au réaménagement ministériel..."
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

      {/* Modal: Préenregistrer un Enseignant */}
      <Modal
        isOpen={showTeacherModal}
        onClose={() => setShowTeacherModal(false)}
        title="Préenregistrer un Enseignant"
        darkMode={true}
      >
        <form onSubmit={handleCreateTeacher} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Matricule Employé *</label>
            <input
              type="text"
              required
              placeholder="Ex: ENS-2026-001"
              value={tEmpNumber}
              onChange={e => setTEmpNumber(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-mono text-amber-300 font-bold focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Prénom *</label>
              <input type="text" required value={tFirstName} onChange={e => setTFirstName(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nom *</label>
              <input type="text" required value={tLastName} onChange={e => setTLastName(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Email</label>
              <input type="email" value={tEmail} onChange={e => setTEmail(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Téléphone</label>
              <input type="tel" value={tPhone} onChange={e => setTPhone(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Sexe *</label>
              <select value={tGender} onChange={e => setTGender(e.target.value as 'M' | 'F')} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500">
                <option value="M" className="bg-slate-900 text-white">Masculin (M)</option>
                <option value="F" className="bg-slate-900 text-white">Féminin (F)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Spécialité</label>
              <input type="text" value={tSpeciality} onChange={e => setTSpeciality(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => setShowTeacherModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black">Enregistrer Dossier</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Préenregistrer un Élève */}
      <Modal
        isOpen={showStudentModal}
        onClose={() => setShowStudentModal(false)}
        title="Préenregistrer un Élève"
        darkMode={true}
      >
        <form onSubmit={handleCreateStudent} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Matricule Scolaire *</label>
            <input
              type="text"
              required
              placeholder="Ex: ELV-2026-001"
              value={sNumber}
              onChange={e => setSNumber(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-mono text-amber-300 font-bold focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Prénom *</label>
              <input type="text" required value={sFirstName} onChange={e => setSFirstName(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nom *</label>
              <input type="text" required value={sLastName} onChange={e => setSLastName(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Post-nom</label>
              <input type="text" value={sMiddleName} onChange={e => setSMiddleName(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white" />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Sexe</label>
              <select value={sGender} onChange={e => setSGender(e.target.value as 'M' | 'F')} className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white">
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase mb-1">Date Naissance</label>
              <input type="date" value={sBirthDate} onChange={e => setSBirthDate(e.target.value)} className="w-full px-3 py-2 bg-slate-950 border-2 border-slate-600 rounded-xl text-xs text-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Lieu de Naissance</label>
              <input type="text" value={sBirthPlace} onChange={e => setSBirthPlace(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Classe d'affectation *</label>
              <select value={sClassId} onChange={e => setSClassId(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500">
                {classes.map(c => <option key={c.id} value={c.id} className="bg-slate-900 text-white">{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Nom du Tuteur / Contact</label>
            <input type="text" value={sGuardianRef} onChange={e => setSGuardianRef(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => setShowStudentModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
            <button type="submit" className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black">Préenregistrer Élève</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Affecter un Enseignant */}
      <Modal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        title="Créer une Affectation Enseignant"
        darkMode={true}
      >
        {(() => {
          const activeAssignClassId = assignClassId || (classes[0]?.id ?? '');
          const targetClass = classes.find(c => c.id === activeAssignClassId);
          const isPrimaryHomeroom = targetClass?.pedagogical_mode === 'primary_homeroom';

          return (
            <form onSubmit={handleCreateAssignment} className="space-y-4 text-xs">
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">1. Classe *</label>
                <select
                  value={activeAssignClassId}
                  onChange={e => setAssignClassId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                >
                  {classes.map(c => (
                    <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                      {c.name} {c.pedagogical_mode === 'primary_homeroom' ? '(Primaire Titulaire)' : '(Secondaire par Matière)'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">2. Enseignant *</label>
                <select
                  value={assignTeacherId || (teachers[0]?.id ?? '')}
                  onChange={e => setAssignTeacherId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                >
                  {teachers.map(t => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                      {t.first_name} {t.last_name} ({t.employee_number})
                    </option>
                  ))}
                </select>
              </div>

              {isPrimaryHomeroom ? (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 text-xs font-medium">
                  <strong>Mode Titulaire Primaire :</strong> Le titulaire enseignera automatiquement toutes les matières configurées pour cette classe.
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">3. Matière *</label>
                  <select
                    value={assignSubjectId || (subjects[0]?.id ?? '')}
                    onChange={e => setAssignSubjectId(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500"
                  >
                    {subjects.map(s => (
                      <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                        {s.name} ({s.code || 'SANS CODE'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button type="button" onClick={() => setShowAssignModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-extrabold bg-amber-500 text-slate-950 rounded-xl font-black"
                >
                  {isPrimaryHomeroom ? 'Affecter comme titulaire' : 'Valider l’affectation'}
                </button>
              </div>
            </form>
          );
        })()}
      </Modal>

      {/* Modal: Confirmation de Remplacement du Titulaire */}
      {showConfirmReplaceHomeroom && (
        <Modal
          isOpen={showConfirmReplaceHomeroom}
          onClose={() => {
            setShowConfirmReplaceHomeroom(false);
            setPendingPrimaryReplace(null);
          }}
          title="Remplacement du Titulaire de Classe"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300">
              <p className="font-extrabold text-white">Confirmation requise</p>
              <p className="mt-1 leading-relaxed">
                La classe <strong className="text-white">{pendingPrimaryReplace?.className}</strong> possède déjà un enseignant titulaire.
                Voulez-vous remplacer le titulaire actuel par <strong className="text-amber-300">{pendingPrimaryReplace?.newTeacherName}</strong> ?
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowConfirmReplaceHomeroom(false);
                  setPendingPrimaryReplace(null);
                }}
                className="px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!pendingPrimaryReplace) return;
                  try {
                    const { error } = await supabase.rpc('assign_class_homeroom_teacher', {
                      p_class_id: pendingPrimaryReplace.classId,
                      p_teacher_id: pendingPrimaryReplace.teacherId
                    });
                    if (error) throw error;
                    showToast('Enseignant titulaire remplacé avec succès !', 'success');
                    setShowConfirmReplaceHomeroom(false);
                    setShowAssignModal(false);
                    setPendingPrimaryReplace(null);
                    loadSchoolPortalData();
                  } catch (err: any) {
                    showToast(err?.message || 'Erreur lors du remplacement du titulaire.', 'warning');
                  }
                }}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-black cursor-pointer"
              >
                Confirmer le Remplacement
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Importation CSV */}
      <Modal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        title={`Importation CSV - ${importType.toUpperCase()}`}
        darkMode={true}
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">Sélectionner le fichier CSV *</label>
            <input type="file" accept=".csv,.txt" onChange={handleFileChange} className="w-full text-slate-300 text-xs" />
          </div>

          {importValidationErrors.length > 0 && (
            <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-xl text-rose-300 space-y-1">
              <p className="font-bold">Erreurs de Validation détectées :</p>
              {importValidationErrors.map((err, idx) => <p key={idx}>• {err}</p>)}
            </div>
          )}

          {importPreviewRows.length > 0 && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <p className="font-bold text-amber-400">Aperçu : {importPreviewRows.length} ligne(s) détectée(s)</p>
              <div className="max-h-40 overflow-y-auto font-mono text-[10px] text-slate-300">
                {importPreviewRows.slice(0, 5).map((r, idx) => (
                  <p key={idx}>#{idx + 1} : {JSON.stringify(r)}</p>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => setShowImportModal(false)} className="px-4 py-2 text-xs font-bold text-slate-300">Annuler</button>
            <button
              type="button"
              disabled={isProcessingImport || importPreviewRows.length === 0 || importValidationErrors.length > 0}
              onClick={handleConfirmImport}
              className="px-5 py-2 text-xs font-black bg-amber-500 text-slate-950 rounded-xl disabled:opacity-40"
            >
              {isProcessingImport ? 'Traitement...' : 'Confirmer l’Importation'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Changer de Classe / Affecter Élève */}
      {selectedStudentForClassChange && showChangeClassModal && (
        <Modal
          isOpen={showChangeClassModal}
          onClose={() => setShowChangeClassModal(false)}
          title={`Affectation de Classe — ${selectedStudentForClassChange.first_name} ${selectedStudentForClassChange.last_name}`}
          darkMode={true}
        >
          <form onSubmit={handleSaveChangeClass} className="space-y-4 text-xs">
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Élève :</span>
                <span className="font-extrabold text-white">{selectedStudentForClassChange.first_name} {selectedStudentForClassChange.last_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Matricule :</span>
                <span className="font-mono text-amber-400 font-bold">{selectedStudentForClassChange.student_number}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Sélectionner la classe cible *
              </label>
              <select
                required
                value={targetClassIdForChange}
                onChange={e => setTargetClassIdForChange(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                {classes.map(c => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                    {c.name} ({c.level || 'Général'} - Section {c.section || 'A'})
                  </option>
                ))}
              </select>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              En confirmant, l'inscription actuelle sera clôturée (statut <code>transferred</code>) et une nouvelle inscription active (<code>status = 'active'</code>) sera créée dans la table <code>student_enrollments</code> pour l'année scolaire active.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowChangeClassModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={changingClass}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl cursor-pointer"
              >
                {changingClass ? 'Enregistrement...' : 'Valider l\'affectation'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal 1: Nouvelle Séance d'Appel */}
      {showNewSessionModal && (
        <Modal
          isOpen={showNewSessionModal}
          onClose={() => setShowNewSessionModal(false)}
          title="Nouvelle Séance de Présence / Appel"
          darkMode={true}
        >
          <form onSubmit={handleCreateAttendanceSession} className="space-y-4 text-xs">
            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Sélectionner la Classe *
              </label>
              <select
                required
                value={newSessionClassId}
                onChange={e => setNewSessionClassId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="">-- Choisir la classe --</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                    {c.name} ({c.level || 'Général'} - Section {c.section || 'A'})
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

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Matière Concernée (Optionnel)
              </label>
              <select
                value={newSessionSubjectId}
                onChange={e => setNewSessionSubjectId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-500 cursor-pointer"
              >
                <option value="">-- Appel Général (Toutes matières) --</option>
                {subjects.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-900 text-white">
                    {s.name} ({s.code || 'SANS-CODE'})
                  </option>
                ))}
              </select>
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
                disabled={creatingSession}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl cursor-pointer"
              >
                {creatingSession ? 'Création...' : 'Créer et Faire l\'Appel'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal 2: Feuille d'Appel Interactive (Faire / Corriger l'Appel) */}
      {selectedSession && showTakeAttendanceModal && (
        <Modal
          isOpen={showTakeAttendanceModal}
          onClose={() => setShowTakeAttendanceModal(false)}
          title={`Feuille d'Appel — ${classes.find(c => c.id === selectedSession.class_id)?.name} (${new Date(selectedSession.attendance_date).toLocaleDateString('fr-FR')})`}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            {/* Header info & actions */}
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-white">Élèves Inscrits : {sheetRecords.length}</span>
                  {selectedSession.status === 'completed' && (
                    <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full font-extrabold text-[10px] inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Séance Finalisée (Lecture Seule)</span>
                    </span>
                  )}
                  {selectedSession.status === 'draft' && (
                    <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full font-bold text-[10px]">
                      Brouillon
                    </span>
                  )}
                  {selectedSession.status === 'reopened' && (
                    <span className="px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-full font-bold text-[10px]">
                      Rouverte
                    </span>
                  )}
                </div>
                {selectedSession.status === 'completed' && (
                  <p className="text-[11px] text-slate-400 mt-1">
                    Pour modifier une présence sur cette séance terminée, cliquez sur <strong>« Corriger cette présence »</strong> sur la ligne de l'élève ou utilisez <strong>« Rouvrir la séance »</strong>.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedSession.status !== 'completed' && (
                  <button
                    type="button"
                    onClick={handleMarkAllPresent}
                    className="px-3.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl font-extrabold text-xs cursor-pointer transition-colors whitespace-nowrap"
                  >
                    ✓ Tout marquer Présents
                  </button>
                )}

                {selectedSession.status === 'completed' && (
                  <button
                    type="button"
                    onClick={() => {
                      setReopenReasonText('');
                      setShowReopenModal(true);
                    }}
                    className="px-3.5 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-xl font-extrabold text-xs cursor-pointer transition-colors flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Rouvrir la séance</span>
                  </button>
                )}
              </div>
            </div>

            {/* Student Records Table */}
            {sheetRecords.length === 0 ? (
              <div className="p-6 text-center bg-slate-950 rounded-xl border border-slate-800 text-slate-400">
                Aucun élève actif n'est inscrit dans cette classe.
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {sheetRecords.map((item, idx) => {
                  const isCompleted = selectedSession.status === 'completed';

                  return (
                    <div key={item.student.id} className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-amber-400 font-bold">#{idx + 1}</span>
                          <div>
                            <p className="font-extrabold text-white text-xs">{item.student.first_name} {item.student.last_name}</p>
                            <span className="text-[10px] text-slate-400 font-mono">{item.student.student_number}</span>
                          </div>
                        </div>

                        {/* Status Display or Toggle Buttons */}
                        {isCompleted ? (
                          <div className="flex items-center gap-2">
                            <span className={`px-3 py-1 rounded-xl font-extrabold text-xs uppercase ${
                              item.status === 'present' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' :
                              item.status === 'absent' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                              item.status === 'late' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                              'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                            }`}>
                              {item.status === 'present' ? 'Présent' : item.status === 'absent' ? 'Absent' : item.status === 'late' ? `Retard (${item.arrival_time || 'N/A'})` : 'Excusé'}
                            </span>

                            {/* Single Action: Corriger cette présence */}
                            <button
                              type="button"
                              onClick={() => openCorrectionForStudent(item, item.status === 'present' ? 'absent' : 'present')}
                              className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl font-bold text-xs cursor-pointer transition-colors"
                            >
                              Corriger cette présence
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleUpdateSheetItem(item.student.id, { status: 'present' })}
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                                item.status === 'present'
                                  ? 'bg-emerald-500 text-slate-950 font-black'
                                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                              }`}
                            >
                              Présent
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateSheetItem(item.student.id, { status: 'absent' })}
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                                item.status === 'absent'
                                  ? 'bg-rose-600 text-white font-black'
                                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                              }`}
                            >
                              Absent
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateSheetItem(item.student.id, { status: 'late' })}
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                                item.status === 'late'
                                  ? 'bg-amber-500 text-slate-950 font-black'
                                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                              }`}
                            >
                              Retard
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateSheetItem(item.student.id, { status: 'excused' })}
                              className={`px-2.5 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                                item.status === 'excused'
                                  ? 'bg-indigo-600 text-white font-black'
                                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                              }`}
                            >
                              Excusé
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Additional fields for Late / Excused / Absent (only in draft/reopened mode) */}
                      {!isCompleted && (item.status === 'late' || item.status === 'excused' || item.status === 'absent') && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-900">
                          {item.status === 'late' && (
                            <div>
                              <label className="block text-[10px] text-slate-400 font-bold uppercase mb-0.5">Heure d'arrivée</label>
                              <input
                                type="time"
                                value={item.arrival_time}
                                onChange={e => handleUpdateSheetItem(item.student.id, { arrival_time: e.target.value })}
                                className="w-full px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white"
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-[10px] text-slate-400 font-bold uppercase mb-0.5">Justification élève (Motif de l'absence)</label>
                            <input
                              type="text"
                              placeholder="Motif de l'absence/retard"
                              value={item.justification}
                              onChange={e => handleUpdateSheetItem(item.student.id, { justification: e.target.value })}
                              className="w-full px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder:text-slate-600"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowTakeAttendanceModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300 cursor-pointer"
              >
                Fermer
              </button>

              {selectedSession.status !== 'completed' && (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleSaveAttendanceSheet(false)}
                    className="px-4 py-2 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-white rounded-xl cursor-pointer w-full sm:w-auto"
                  >
                    {savingAttendance ? 'Enregistrement...' : 'Enregistrer Brouillon'}
                  </button>
                  <button
                    type="button"
                    disabled={savingAttendance}
                    onClick={() => handleSaveAttendanceSheet(true)}
                    className="px-5 py-2 text-xs font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer shadow-md w-full sm:w-auto"
                  >
                    {savingAttendance ? 'Finalisation...' : 'Finaliser l\'Appel'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal 3: Rouvrir une Séance de Présence (School-Admin uniquement) */}
      {selectedSession && showReopenModal && (
        <Modal
          isOpen={showReopenModal}
          onClose={() => setShowReopenModal(false)}
          title="Réouverture d'une Séance de Présence Finalisée"
          darkMode={true}
        >
          <form onSubmit={handleReopenAttendanceSession} className="space-y-4 text-xs">
            <div className="p-4 bg-indigo-950/40 border-2 border-indigo-500/50 rounded-2xl text-indigo-300 space-y-1">
              <h4 className="font-extrabold text-white text-sm">Action de Supervision d'Établissement</h4>
              <p className="leading-relaxed text-slate-300">
                La réouverture déverrouillera cette séance pour permettre des corrections d'appel. Cette action exige la saisie d'un motif clair et sera enregistrée dans les journaux d'audit de l'école.
              </p>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1.5">
                Motif Obligatoire de Réouverture *
              </label>
              <textarea
                required
                rows={3}
                placeholder="Indiquez le motif précis de la réouverture (ex: Correction d'une erreur de saisie par l'enseignant)..."
                value={reopenReasonText}
                onChange={e => setReopenReasonText(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-slate-600 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowReopenModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={reopeningSession || !reopenReasonText.trim()}
                className="px-5 py-2 text-xs font-extrabold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl cursor-pointer"
              >
                {reopeningSession ? 'Réouverture...' : 'Rouvrir la Séance'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal 4: Confirmer la Correction d'une Présence sur Séance Finalisée */}
      {showIndividualCorrectionModal && correctionTarget && (
        <Modal
          isOpen={showIndividualCorrectionModal}
          onClose={() => setShowIndividualCorrectionModal(false)}
          title="Confirmer la correction d'une présence"
          darkMode={true}
        >
          <form onSubmit={handleConfirmIndividualCorrection} className="space-y-4 text-xs">
            <div className="p-4 bg-amber-950/40 border-2 border-amber-500/50 rounded-2xl text-amber-200 space-y-2">
              <h4 className="font-extrabold text-white text-sm">Correction d'Appel Finalisé</h4>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
                <div>
                  <span className="text-slate-400 font-bold">Élève concerné :</span>
                  <p className="font-extrabold text-white">{correctionTarget.student.first_name} {correctionTarget.student.last_name}</p>
                  <p className="text-[10px] font-mono text-slate-400">{correctionTarget.student.student_number}</p>
                </div>
                <div>
                  <span className="text-slate-400 font-bold">Changement de Statut :</span>
                  <div className="flex items-center gap-1 pt-1">
                    <span className="px-2 py-0.5 bg-slate-900 text-slate-400 rounded font-mono font-bold uppercase text-[10px]">{correctionTarget.oldStatus}</span>
                    <span>➔</span>
                    <select
                      value={correctionTarget.newStatus}
                      onChange={e => setCorrectionTarget({ ...correctionTarget, newStatus: e.target.value as any })}
                      className="px-2 py-1 bg-slate-950 border border-amber-500 rounded text-amber-300 font-extrabold text-xs cursor-pointer"
                    >
                      <option value="present">Présent</option>
                      <option value="absent">Absent</option>
                      <option value="late">Retard</option>
                      <option value="excused">Excusé</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Additional parameters for the target status */}
            {correctionTarget.newStatus === 'late' && (
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1">
                  Heure d'arrivée de l'élève
                </label>
                <input
                  type="time"
                  value={correctionTarget.arrivalTime}
                  onChange={e => setCorrectionTarget({ ...correctionTarget, arrivalTime: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                />
              </div>
            )}

            {(correctionTarget.newStatus === 'absent' || correctionTarget.newStatus === 'late' || correctionTarget.newStatus === 'excused') && (
              <div>
                <label className="block text-xs font-extrabold text-slate-200 uppercase tracking-wider mb-1">
                  Justification de l'absence / retard de l'élève (Raison élève)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Maladie, rendez-vous médical, problème de transport..."
                  value={correctionTarget.justification}
                  onChange={e => setCorrectionTarget({ ...correctionTarget, justification: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                />
              </div>
            )}

            {/* Mandatory Administrative Correction Reason */}
            <div>
              <label className="block text-xs font-extrabold text-amber-400 uppercase tracking-wider mb-1">
                Motif administratif de la correction * (Obligatoire)
              </label>
              <textarea
                required
                rows={3}
                placeholder="Indiquez la raison administrative du changement (ex: Justificatif médical reçu après l'appel)..."
                value={correctionReasonText}
                onChange={e => setCorrectionReasonText(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border-2 border-amber-500/60 rounded-xl text-sm font-medium text-white focus:outline-none focus:border-amber-400"
              />
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                Expliquez pourquoi cette présence est modifiée après la finalisation de l'appel. Ce motif sera conservé dans le journal d'audit.
              </p>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-bold text-slate-400">Motifs administratifs courants :</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Justificatif médical reçu après l’appel",
                  "Erreur de saisie lors de l’appel",
                  "Arrivée de l’élève confirmée ultérieurement"
                ].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCorrectionReasonText(preset)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-[11px] cursor-pointer transition-colors"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowIndividualCorrectionModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-300"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submittingCorrection || !correctionReasonText.trim()}
                className="px-5 py-2 text-xs font-extrabold bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 rounded-xl cursor-pointer shadow-md"
              >
                {submittingCorrection ? 'Correction...' : 'Valider la Correction'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL ADMIN: DETAILS DEVOIR */}
      {showAdminHwDetailModal && selectedAdminHw && (
        <Modal
          isOpen={showAdminHwDetailModal}
          onClose={() => setShowAdminHwDetailModal(false)}
          title={`Supervision Devoir : ${selectedAdminHw.title}`}
          darkMode={true}
        >
          <div className="space-y-5 text-xs">
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="font-extrabold text-white text-sm block">{selectedAdminHw.teacher_name}</span>
                  <span className="text-[11px] text-slate-400">Enseignant créateur</span>
                </div>
                <div>
                  {selectedAdminHw.status === 'draft' && (
                    <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg font-bold">
                      Brouillon
                    </span>
                  )}
                  {selectedAdminHw.status === 'published' && new Date(selectedAdminHw.due_at) >= new Date() && (
                    <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg font-bold">
                      Publié
                    </span>
                  )}
                  {selectedAdminHw.status === 'published' && new Date(selectedAdminHw.due_at) < new Date() && (
                    <span className="px-2.5 py-1 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-lg font-black animate-pulse">
                      En retard
                    </span>
                  )}
                  {selectedAdminHw.status === 'closed' && (
                    <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-lg font-bold">
                      Clôturé
                    </span>
                  )}
                  {selectedAdminHw.status === 'cancelled' && (
                    <span className="px-2.5 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-lg font-bold">
                      Annulé
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-slate-400 pt-3 border-t border-slate-800/80">
                <div>Classe : <strong className="text-amber-300">{selectedAdminHw.class_name}</strong></div>
                <div>Matière : <strong className="text-white">{selectedAdminHw.subject_name}</strong></div>
                <div>Assigné le : <strong className="text-white">{new Date(selectedAdminHw.assigned_on).toLocaleDateString('fr-FR')}</strong></div>
                <div>Échéance : <strong className="text-amber-400">{new Date(selectedAdminHw.due_at).toLocaleDateString('fr-FR')} à {new Date(selectedAdminHw.due_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
                {selectedAdminHw.estimated_minutes && <div>Durée estimée : <strong className="text-white">{selectedAdminHw.estimated_minutes} min</strong></div>}
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="font-bold text-slate-300">Consignes transmises :</span>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-slate-300 whitespace-pre-wrap leading-relaxed">
                {selectedAdminHw.instructions}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAdminHwDetailModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Fermer
              </button>

              {selectedAdminHw.status !== 'cancelled' && (
                <button
                  type="button"
                  onClick={() => {
                    setAdminCancelReason('');
                    setShowAdminHwCancelModal(true);
                  }}
                  className="px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl font-bold cursor-pointer flex items-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Annuler Administrativement</span>
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL ADMIN: ANNULER UN DEVOIR */}
      {showAdminHwCancelModal && selectedAdminHw && (
        <Modal
          isOpen={showAdminHwCancelModal}
          onClose={() => setShowAdminHwCancelModal(false)}
          title={`Annulation Administrative : ${selectedAdminHw.title}`}
          darkMode={true}
        >
          <form onSubmit={handleAdminCancelHomework} className="space-y-4 text-xs">
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>Cette annulation administrative est irréversible. L'action sera inscrite de manière immuable dans le journal d'audit de l'école.</span>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Motif d'annulation administrative *</label>
              <textarea
                value={adminCancelReason}
                onChange={e => setAdminCancelReason(e.target.value)}
                rows={3}
                placeholder="Ex: Décision de la direction pour cas de force majeure ou aménagement du calendrier..."
                required
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-800 text-xs focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAdminHwCancelModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Retour
              </button>
              <button
                type="submit"
                disabled={submittingAdminCancel || !adminCancelReason.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-xl cursor-pointer transition-colors disabled:opacity-40"
              >
                {submittingAdminCancel ? 'Annulation...' : 'Confirmer l’annulation administrative'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL ADMIN: CRÉER / INVITER UN RESPONSABLE PARENT */}
      {showParentModal && (
        <Modal
          isOpen={showParentModal}
          onClose={() => setShowParentModal(false)}
          title="Créer & Inviter un Responsable Légal"
          darkMode={true}
        >
          <form onSubmit={handleInviteParentSubmit} className="space-y-4 text-xs">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
              Le parent recevra un email d'invitation sécurisé pour définir son mot de passe et activer son espace.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Prénom *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Jean"
                  value={pFirstName}
                  onChange={e => setPFirstName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-300 mb-1">Nom *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Mukendi"
                  value={pLastName}
                  onChange={e => setPLastName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-300 mb-1">Adresse Email *</label>
                <input
                  type="email"
                  required
                  placeholder="Ex: jean.mukendi@example.com"
                  value={pEmail}
                  onChange={e => setPEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-300 mb-1">Numéro de Téléphone</label>
                <input
                  type="tel"
                  placeholder="Ex: +243 812 345 678"
                  value={pPhone}
                  onChange={e => setPPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Type de Responsabilité *</label>
              <select
                value={pRelationship}
                onChange={e => {
                  const val = e.target.value;
                  setPRelationship(val);
                  if (val === 'Personne autorisée à récupérer') {
                    setPCanAcademic(false);
                    setPCanAttendance(false);
                    setPCanHomework(false);
                    setPCanFinances(false);
                    setPCanNotifications(false);
                    setPCanPickup(true);
                  }
                }}
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="Père">Père</option>
                <option value="Mère">Mère</option>
                <option value="Tuteur">Tuteur</option>
                <option value="Tutrice">Tutrice</option>
                <option value="Responsable légal">Responsable légal</option>
                <option value="Personne autorisée à récupérer">Personne autorisée à récupérer l'enfant uniquement</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">
                Rattacher à l'élève / aux élèves ({pStudentIds.length} sélectionné{pStudentIds.length > 1 ? 's' : ''}) *
              </label>
              <div className="max-h-36 overflow-y-auto bg-slate-950 border border-slate-800 rounded-xl p-2 space-y-1">
                {students.length === 0 ? (
                  <p className="text-slate-500 text-[11px] p-2">Aucun élève enregistré dans l'école.</p>
                ) : (
                  students.map(s => {
                    const isSelected = pStudentIds.includes(s.id);
                    const sClass = classes.find(c => c.id === s.class_id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                          isSelected ? 'bg-emerald-950/40 border border-emerald-500/30' : 'hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              if (isSelected) {
                                setPStudentIds(pStudentIds.filter(id => id !== s.id));
                              } else {
                                setPStudentIds([...pStudentIds, s.id]);
                              }
                            }}
                            className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="font-bold text-white">
                            {s.first_name} {s.last_name}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">({s.student_number})</span>
                        </div>
                        {sClass && (
                          <span className="text-[10px] px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded font-medium">
                            {sClass.name}
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-2">Permissions Granulaires d'Accès</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pCanAcademic}
                    onChange={e => setPCanAcademic(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Consulter les notes & résultats</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pCanAttendance}
                    onChange={e => setPCanAttendance(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Consulter les présences</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pCanHomework}
                    onChange={e => setPCanHomework(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Consulter le cahier de textes / devoirs</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pCanFinances}
                    onChange={e => setPCanFinances(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Consulter les finances / frais</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pCanNotifications}
                    onChange={e => setPCanNotifications(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Recevoir les alertes SMS / WhatsApp</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pCanPickup}
                    onChange={e => setPCanPickup(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Autorisé à récupérer l'élève à la sortie</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowParentModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={invitingParent || pStudentIds.length === 0}
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl cursor-pointer transition-colors disabled:opacity-40"
              >
                {invitingParent ? 'Envoi en cours...' : 'Inviter le Responsable'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL ADMIN: MODIFIER LE LIEN PARENT-ÉLÈVE */}
      {showEditLinkModal && selectedLinkToEdit && selectedParentForLink && (
        <Modal
          isOpen={showEditLinkModal}
          onClose={() => setShowEditLinkModal(false)}
          title={`Gérer le lien avec l'élève : ${selectedLinkToEdit.first_name} ${selectedLinkToEdit.last_name}`}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <p className="text-slate-400">Responsable : <strong className="text-white">{selectedParentForLink.first_name} {selectedParentForLink.last_name}</strong></p>
              <p className="text-slate-400">Élève : <strong className="text-white">{selectedLinkToEdit.first_name} {selectedLinkToEdit.last_name}</strong> ({selectedLinkToEdit.student_number})</p>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Relation / Rôle</label>
              <select
                defaultValue={selectedLinkToEdit.relationship}
                id="editLinkRelSelect"
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="Père">Père</option>
                <option value="Mère">Mère</option>
                <option value="Tuteur">Tuteur</option>
                <option value="Tutrice">Tutrice</option>
                <option value="Responsable légal">Responsable légal</option>
                <option value="Personne autorisée à récupérer">Personne autorisée à récupérer</option>
              </select>
            </div>

            <div className="space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <label className="block font-bold text-slate-300 mb-1">Permissions d'accès</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="editPermAcademic"
                  defaultChecked={selectedLinkToEdit.can_view_academic}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Consulter les notes & résultats</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="editPermAttendance"
                  defaultChecked={selectedLinkToEdit.can_view_attendance}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Consulter les présences</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="editPermHomework"
                  defaultChecked={selectedLinkToEdit.can_view_homework}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Consulter les devoirs</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="editPermFinances"
                  defaultChecked={selectedLinkToEdit.can_view_finances}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Consulter les finances</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="editPermNotifications"
                  defaultChecked={selectedLinkToEdit.can_receive_notifications}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Recevoir les notifications</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  id="editPermPickup"
                  defaultChecked={selectedLinkToEdit.can_pickup_student}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                />
                <span>Autorisé à récupérer l'élève</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2">
                {selectedLinkToEdit.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleManageLinkAction(selectedLinkToEdit.link_id, 'approve')}
                      className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 rounded-xl font-bold cursor-pointer"
                    >
                      Approuver le lien
                    </button>
                    <button
                      type="button"
                      onClick={() => handleManageLinkAction(selectedLinkToEdit.link_id, 'reject')}
                      className="px-3 py-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 rounded-xl font-bold cursor-pointer"
                    >
                      Rejeter
                    </button>
                  </>
                )}

                {selectedLinkToEdit.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => handleManageLinkAction(selectedLinkToEdit.link_id, 'revoke')}
                    className="px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 rounded-xl font-bold cursor-pointer"
                  >
                    Révoquer l'accès
                  </button>
                )}

                {(selectedLinkToEdit.status === 'rejected' || selectedLinkToEdit.status === 'revoked') && (
                  <button
                    type="button"
                    onClick={() => handleManageLinkAction(selectedLinkToEdit.link_id, 'update_permissions')}
                    className="px-3 py-1.5 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 rounded-xl font-bold cursor-pointer"
                  >
                    Lien désactivé ({selectedLinkToEdit.status})
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  const rel = (document.getElementById('editLinkRelSelect') as HTMLSelectElement)?.value;
                  const acad = (document.getElementById('editPermAcademic') as HTMLInputElement)?.checked;
                  const att = (document.getElementById('editPermAttendance') as HTMLInputElement)?.checked;
                  const hw = (document.getElementById('editPermHomework') as HTMLInputElement)?.checked;
                  const fin = (document.getElementById('editPermFinances') as HTMLInputElement)?.checked;
                  const notif = (document.getElementById('editPermNotifications') as HTMLInputElement)?.checked;
                  const pick = (document.getElementById('editPermPickup') as HTMLInputElement)?.checked;

                  handleManageLinkAction(selectedLinkToEdit.link_id, 'update_permissions', rel, {
                    can_view_academic: acad,
                    can_view_attendance: att,
                    can_view_homework: hw,
                    can_view_finances: fin,
                    can_receive_notifications: notif,
                    can_pickup_student: pick
                  });
                }}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black rounded-xl cursor-pointer"
              >
                Enregistrer les modifications
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL ADMIN: INVITER UN ÉLÈVE */}
      {showStudentInviteModal && selectedStudentForInvite && (
        <Modal
          isOpen={showStudentInviteModal}
          onClose={() => setShowStudentInviteModal(false)}
          title={`Inviter l'Élève : ${selectedStudentForInvite.first_name || ''} ${selectedStudentForInvite.last_name || selectedStudentForInvite.student_number}`}
          darkMode={true}
        >
          <form onSubmit={handleInviteStudentSubmit} className="space-y-4 text-xs">
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-300 text-xs">
              L'élève recevra un lien sécurisé à cette adresse email pour définir son mot de passe et activer son compte numérique.
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
              <p className="text-slate-400">Matricule : <strong className="text-amber-400 font-mono">{selectedStudentForInvite.student_number}</strong></p>
              <p className="text-slate-400">Élève : <strong className="text-white">{selectedStudentForInvite.first_name} {selectedStudentForInvite.last_name}</strong></p>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Adresse Email Personnelle de l'Élève *</label>
              <input
                type="email"
                required
                placeholder="Ex: eleve.mukendi@example.com"
                value={studentInviteEmail}
                onChange={e => setStudentInviteEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 text-white rounded-xl border border-slate-700 text-xs focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Ne pas utiliser l'adresse email des parents.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowStudentInviteModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={Boolean(invitingStudentId) || !studentInviteEmail.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl cursor-pointer transition-colors disabled:opacity-40"
              >
                {invitingStudentId ? 'Envoi en cours...' : 'Envoyer l’invitation à l’élève'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL ADMIN: CONFIRMATION FORTE CLÔTURE CALENDRIER */}
      {showCloseCalendarModal && (
        <Modal
          isOpen={showCloseCalendarModal}
          onClose={() => !closingCalendar && setShowCloseCalendarModal(false)}
          title={`Confirmation de Clôture : Calendrier Scolaire (${closeCalendarCycle === 'primary' ? 'Primaire' : 'Secondaire'})`}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-rose-200">
                <p className="font-black text-sm text-rose-400">
                  La clôture rendra ce calendrier indisponible dans les portails Élève et Parent.
                </p>
                <p className="text-xs leading-relaxed text-rose-300/90">
                  Une fois le calendrier clôturé, les élèves et les parents rattachés au cycle <strong>{closeCalendarCycle === 'primary' ? 'Primaire' : 'Secondaire'}</strong> ne pourront plus consulter les notes et résultats de cette année scolaire tant que le calendrier n'est pas rouvert en statut Brouillon puis réactivé.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={closingCalendar}
                onClick={() => setShowCloseCalendarModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={closingCalendar}
                onClick={handleConfirmCloseCalendar}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-xl shadow-lg cursor-pointer flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                <span>{closingCalendar ? 'Clôture en cours...' : 'Confirmer la clôture du calendrier'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL ADMIN: GESTION DU PROFESSEUR TITULAIRE */}
      {showHomeroomModal && selectedClassForHomeroom && (
        <Modal
          isOpen={showHomeroomModal}
          onClose={() => {
            setShowHomeroomModal(false);
            setShowConfirmRemoveHomeroom(false);
            setSelectedClassForHomeroom(null);
            setSelectedTeacherIdForHomeroom('');
          }}
          title={`Professeur Titulaire — Classe ${selectedClassForHomeroom.name}`}
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            {/* Header info */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-400 uppercase">Classe sélectionnée :</span>
                <span className="font-extrabold text-white text-sm">{selectedClassForHomeroom.name}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Le professeur titulaire est le garant pédagogique officiel de la classe. Il est seul habilité à générer les brouillons de bulletins périodiques, attribuer les mentions de conduite et soumettre les résultats officiels à la direction.
              </p>
            </div>

            {/* Current Homeroom status */}
            {(() => {
              const currentHr = Boolean(selectedClassForHomeroom.homeroom_teacher_id)
                ? teachers.find(t => Boolean(t.profile_id) && t.profile_id === selectedClassForHomeroom.homeroom_teacher_id && t.school_id === school?.id)
                : null;
              if (!currentHr) {
                return (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 flex items-center justify-between">
                    <span>Aucun professeur titulaire n'est actuellement affecté à cette classe.</span>
                  </div>
                );
              }
              return (
                <div className="p-3 bg-slate-950 border border-emerald-500/40 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-400 block">Titulaire Actuel :</span>
                    <span className="font-extrabold text-white text-xs">{currentHr.first_name} {currentHr.last_name}</span>
                    <span className="font-mono text-slate-400 text-[10px] ml-2">({currentHr.employee_number})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowConfirmRemoveHomeroom(true)}
                    disabled={savingHomeroom}
                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl font-bold cursor-pointer transition-colors"
                  >
                    Retirer le titulaire
                  </button>
                </div>
              );
            })()}

            {/* Confirmation de retrait */}
            {showConfirmRemoveHomeroom && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl space-y-3">
                <p className="font-extrabold text-rose-300 text-xs">
                  Êtes-vous sûr de vouloir retirer le professeur titulaire de la classe {selectedClassForHomeroom.name} ?
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirmRemoveHomeroom(false)}
                    className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-xl font-bold cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={savingHomeroom}
                    onClick={handleRemoveHomeroomTeacher}
                    className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-xl cursor-pointer"
                  >
                    {savingHomeroom ? 'Retrait en cours...' : 'Confirmer le retrait'}
                  </button>
                </div>
              </div>
            )}

            {/* Confirmation Forte de Remplacement */}
            {showConfirmReplaceHomeroom && (() => {
              const oldTeacher = Boolean(selectedClassForHomeroom.homeroom_teacher_id)
                ? teachers.find(t => Boolean(t.profile_id) && t.profile_id === selectedClassForHomeroom.homeroom_teacher_id && t.school_id === school?.id)
                : null;
              const newTeacher = teachers.find(t => t.id === selectedTeacherIdForHomeroom && t.school_id === school?.id);
              return (
                <div className="p-4 bg-amber-500/10 border border-amber-500/40 rounded-2xl space-y-3">
                  <div className="space-y-1">
                    <h4 className="font-black text-amber-300 text-sm">Confirmation de Remplacement du Titulaire</h4>
                    <p className="text-slate-300 text-xs">
                      Vous vous apprêtez à remplacer le garant pédagogique de cette classe. Cette opération sera tracée dans le journal d'audit de l'école.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Classe :</span>
                      <strong className="text-white">{selectedClassForHomeroom.name}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-rose-400">Ancien titulaire :</span>
                      <strong className="text-rose-300">
                        {oldTeacher ? `${oldTeacher.first_name} ${oldTeacher.last_name} (${oldTeacher.employee_number})` : 'Aucun'}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-emerald-400">Nouveau titulaire :</span>
                      <strong className="text-emerald-300">
                        {newTeacher ? `${newTeacher.first_name} ${newTeacher.last_name} (${newTeacher.employee_number})` : 'Sélectionné'}
                      </strong>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowConfirmReplaceHomeroom(false)}
                      className="px-3 py-1.5 bg-slate-800 text-slate-300 rounded-xl font-bold cursor-pointer"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      disabled={savingHomeroom}
                      onClick={handleAssignHomeroomTeacher}
                      className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl cursor-pointer shadow-md"
                    >
                      {savingHomeroom ? 'Remplacement...' : 'Confirmer le Remplacement'}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* List of eligible teachers */}
            {!showConfirmRemoveHomeroom && !showConfirmReplaceHomeroom && (
              <div className="space-y-2">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300">
                  Sélectionner un enseignant actif de l'établissement :
                </label>

                {(() => {
                  const eligibleTeachers = teachers.filter(
                    t => t.school_id === school?.id && Boolean(t.profile_id) && t.account_status === 'active' && t.employment_status === 'active'
                  );

                  if (eligibleTeachers.length === 0) {
                    return (
                      <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-center text-slate-400">
                        Aucun enseignant actif avec profil numérique trouvé dans cet établissement.
                      </div>
                    );
                  }

                  return (
                    <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                      {eligibleTeachers.map(t => {
                        const conflictingClass = classes.find(
                          c => c.id !== selectedClassForHomeroom.id && Boolean(c.homeroom_teacher_id) && Boolean(t.profile_id) && c.homeroom_teacher_id === t.profile_id
                        );
                        const isCurrent = Boolean(selectedClassForHomeroom.homeroom_teacher_id) && Boolean(t.profile_id) && selectedClassForHomeroom.homeroom_teacher_id === t.profile_id;
                        const isSelected = selectedTeacherIdForHomeroom === t.id;
                        const isDisabled = Boolean(conflictingClass) && !isCurrent;

                        return (
                          <div
                            key={t.id}
                            onClick={() => !isDisabled && setSelectedTeacherIdForHomeroom(t.id)}
                            className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                              isDisabled
                                ? 'bg-slate-950/40 border-slate-800 opacity-60 cursor-not-allowed'
                                : isSelected
                                ? 'bg-amber-500/10 border-amber-500 text-white cursor-pointer shadow-md'
                                : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300 cursor-pointer'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-white text-xs">{t.first_name} {t.last_name}</span>
                                <span className="font-mono text-amber-400 text-[10px]">{t.employee_number}</span>
                                {isCurrent && (
                                  <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-[9px] font-bold">
                                    Titulaire actuel
                                  </span>
                                )}
                              </div>
                              <p className="text-slate-400 text-[11px]">
                                Spécialité : <strong className="text-slate-300">{t.speciality || 'Enseignement Général'}</strong>
                              </p>
                              {conflictingClass && (
                                <p className="text-amber-400 text-[10px] font-bold">
                                  ⚠️ Déjà titulaire de la classe {conflictingClass.name} (un seul titulaire par classe)
                                </p>
                              )}
                            </div>

                            <input
                              type="radio"
                              name="homeroomTeacherSelect"
                              disabled={isDisabled}
                              checked={isSelected}
                              onChange={() => setSelectedTeacherIdForHomeroom(t.id)}
                              className="accent-amber-500 w-4 h-4 cursor-pointer"
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Replacement confirmation alert */}
                {(() => {
                  const selectedTeacher = teachers.find(t => t.id === selectedTeacherIdForHomeroom);
                  const isReplacing = Boolean(selectedClassForHomeroom.homeroom_teacher_id) &&
                    Boolean(selectedTeacher?.profile_id) &&
                    selectedClassForHomeroom.homeroom_teacher_id !== selectedTeacher?.profile_id;

                  if (isReplacing) {
                    return (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-[11px] leading-relaxed">
                        ⚠️ <strong>Remplacement de titulaire</strong> : Vous allez remplacer l'ancien titulaire par le professeur sélectionné pour la classe <strong>{selectedClassForHomeroom.name}</strong>.
                      </div>
                    );
                  }
                  return null;
                })()}

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setShowHomeroomModal(false);
                      setShowConfirmRemoveHomeroom(false);
                      setShowConfirmReplaceHomeroom(false);
                      setSelectedClassForHomeroom(null);
                      setSelectedTeacherIdForHomeroom('');
                    }}
                    className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={
                      savingHomeroom ||
                      !selectedTeacherIdForHomeroom ||
                      (Boolean(selectedClassForHomeroom.homeroom_teacher_id) &&
                        selectedClassForHomeroom.homeroom_teacher_id === teachers.find(t => t.id === selectedTeacherIdForHomeroom)?.profile_id)
                    }
                    onClick={() => {
                      const selectedTeacher = teachers.find(t => t.id === selectedTeacherIdForHomeroom);
                      const isReplacing = Boolean(selectedClassForHomeroom.homeroom_teacher_id) &&
                        Boolean(selectedTeacher?.profile_id) &&
                        selectedClassForHomeroom.homeroom_teacher_id !== selectedTeacher?.profile_id;

                      if (isReplacing) {
                        setShowConfirmReplaceHomeroom(true);
                      } else {
                        handleAssignHomeroomTeacher();
                      }
                    }}
                    className="px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 font-black rounded-xl cursor-pointer shadow-lg transition-colors"
                  >
                    {savingHomeroom
                      ? 'Enregistrement...'
                      : selectedClassForHomeroom.homeroom_teacher_id
                      ? 'Remplacer le Titulaire'
                      : 'Enregistrer le Titulaire'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Student Dossier Modal */}
      <StudentDossierModal
        isOpen={showStudentDossierModal}
        onClose={() => {
          setShowStudentDossierModal(false);
          setSelectedStudentForDossier(null);
        }}
        studentId={selectedStudentForDossier}
        initialMode={dossierInitialMode}
        onStudentUpdated={() => loadSchoolPortalData()}
      />

      {/* Teacher Dossier Modal */}
      <TeacherDossierModal
        isOpen={showTeacherDossierModal}
        onClose={() => {
          setShowTeacherDossierModal(false);
          setSelectedTeacherForDossier(null);
        }}
        teacherId={selectedTeacherForDossier}
        initialMode={dossierInitialMode}
        onTeacherUpdated={() => loadSchoolPortalData()}
      />

      {/* Footer */}
      <footer className="p-4 sm:p-6 border-t border-slate-900 text-center text-xs text-slate-500">
        ÉcoleConnect — Console d'Administration Établissement ({school?.name})
      </footer>
    </div>
  );
};
