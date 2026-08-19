// Types TypeScript pour la Phase 2F.3 : Bulletins Périodiques Officiels
// Fichier : src/types/reportCard.ts

export type ReportCardBatchStatus = 
  | 'draft' 
  | 'submitted_by_homeroom' 
  | 'validated_by_admin' 
  | 'published' 
  | 'superseded';

export type ReportCardRankType = 'official' | 'provisional';

export interface ReportCardSubjectResult {
  subject_id: string;
  subject_name: string;
  subject_code?: string | null;
  coefficient: number;
  subject_percentage: number | null;
  assessment_count: number;
  completed_assessment_count: number;
  pending_assessment_count: number;
  is_complete: boolean;
  subject_remark?: string | null;
  display_position: number;
}

export interface ReportCardStudentIdentity {
  student_id: string;
  student_number: string;
  student_name: string;
  student_first_name?: string;
  student_last_name?: string;
  gender?: string | null;
  date_of_birth?: string | null;
  class_id: string;
  class_name: string;
  education_cycle?: 'primary' | 'secondary';
  academic_year_id: string;
  academic_year_name: string;
  period_id: string;
  period_name: string;
  period_starts_on?: string | null;
  period_ends_on?: string | null;
  term_name: string;
  school_name: string;
  school_address?: string | null;
  school_phone?: string | null;
  school_email?: string | null;
  logo_url?: string | null;
  official_registration_number?: string | null;
  motto?: string | null;
}

export interface ReportCardSignatures {
  principal_name?: string | null;
  director_signature_url?: string | null;
  stamp_url?: string | null;
  homeroom_teacher_name?: string | null;
  homeroom_teacher_signature_url?: string | null;
  validated_at?: string | null;
}

export interface PeriodReportCardItem {
  report_card_id: string;
  student_id: string;
  student_number: string;
  student_name: string;
  overall_percentage: number | null;
  rank: number | null;
  total_students_ranked: number;
  rank_type: ReportCardRankType;
  is_incomplete: boolean;
  completed_subjects_count: number;
  pending_subjects_count: number;
  total_subject_coefficients: number;
  homeroom_teacher_remarks?: string | null;
  conduct_grade?: string | null;
  principal_remarks?: string | null;
  pdf_storage_path?: string | null;
  pdf_generated_at?: string | null;
  pdf_version?: number;
  identity?: ReportCardStudentIdentity;
  signatures?: ReportCardSignatures;
  subjects: ReportCardSubjectResult[];
}

export interface ReportCardBatchManagement {
  batch_id: string;
  school_id: string;
  academic_year_id: string;
  class_id: string;
  class_name: string;
  period_id: string;
  revision_number: number;
  status: ReportCardBatchStatus;
  total_students_count: number;
  complete_students_count: number;
  incomplete_students_count: number;
  submitted_at?: string | null;
  validated_at?: string | null;
  published_at?: string | null;
  returned_to_draft_at?: string | null;
  return_reason?: string | null;
  report_cards: PeriodReportCardItem[];
}

export interface SchoolOfficialPrerequisites {
  hasPrincipalName: boolean;
  hasDirectorSignature: boolean;
  hasStamp: boolean;
  hasHomeroomTeacher: boolean;
  hasHomeroomSignature: boolean;
  isReadyForValidation: boolean;
}
