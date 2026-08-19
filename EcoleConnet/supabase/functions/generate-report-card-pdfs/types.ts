// Types pour l'Edge Function de génération des PDF de bulletins scolaires
// Fichier : supabase/functions/generate-report-card-pdfs/types.ts

export interface GeneratePdfsRequestBody {
  batch_id: string;
}

export interface CallerProfile {
  id: string;
  role: 'super_admin' | 'school_admin' | 'teacher' | 'student' | 'parent';
  is_active: boolean;
  school_id: string | null;
}

export interface ReportCardBatchRecord {
  id: string;
  school_id: string;
  academic_year_id: string;
  class_id: string;
  period_id: string;
  revision_number: number;
  status: string;
  validated_at: string | null;
  validated_by: string | null;
}

export interface IdentitySnapshot {
  student_id?: string;
  student_number?: string;
  student_name?: string;
  student_first_name?: string;
  student_last_name?: string;
  gender?: string;
  date_of_birth?: string;
  class_id?: string;
  class_name?: string;
  education_cycle?: string;
  academic_year_id?: string;
  academic_year_name?: string;
  period_id?: string;
  period_name?: string;
  period_starts_on?: string;
  period_ends_on?: string;
  term_name?: string;
  school_name?: string;
  school_address?: string;
  school_phone?: string;
  school_email?: string;
  logo_url?: string;
  official_registration_number?: string;
  motto?: string;
}

export interface SignatureSnapshot {
  principal_name?: string;
  director_signature_url?: string;
  stamp_url?: string;
  homeroom_teacher_name?: string;
  homeroom_teacher_signature_url?: string;
  validated_at?: string;
}

export interface CalculationSnapshot {
  total_weighted_points?: number;
  total_possible_weighted_points?: number;
  total_coefficients?: number;
  average_percentage?: number;
  [key: string]: any;
}

export interface PeriodReportCardRecord {
  id: string;
  batch_id: string;
  school_id: string;
  academic_year_id: string;
  class_id: string;
  period_id: string;
  student_id: string;
  enrollment_id: string;
  overall_percentage: number | null;
  rank: number | null;
  total_students_ranked: number | null;
  rank_type: 'official' | 'provisional' | null;
  is_incomplete: boolean;
  completed_subjects_count: number;
  pending_subjects_count: number;
  total_subject_coefficients: number;
  calculation_snapshot: CalculationSnapshot | null;
  identity_snapshot: IdentitySnapshot | null;
  signature_snapshot: SignatureSnapshot | null;
  homeroom_teacher_remarks: string | null;
  conduct_grade: string | null;
  principal_remarks: string | null;
  pdf_storage_path: string | null;
  pdf_generated_at: string | null;
  pdf_checksum: string | null;
  pdf_version: number | null;
}

export interface ReportCardSubjectResultRecord {
  id: string;
  report_card_id: string;
  subject_id: string;
  subject_name_snapshot: string;
  subject_code_snapshot: string | null;
  coefficient: number;
  subject_percentage: number | null;
  assessment_count: number;
  completed_assessment_count: number;
  pending_assessment_count: number;
  is_complete: boolean;
  subject_remark: string | null;
  display_position: number;
}

export interface LoadedImages {
  logo?: Uint8Array | null;
  directorSignature: Uint8Array;
  stamp: Uint8Array;
  homeroomSignature: Uint8Array;
}

export interface SinglePdfGenerationResult {
  report_card_id: string;
  student_id: string;
  student_name: string;
  status: 'generated' | 'skipped' | 'failed';
  storage_path?: string;
  checksum?: string;
  version?: number;
  error_code?: string;
}

export interface ErrorResponse {
  error: string;
  error_code: string;
  correlation_id: string;
  details?: Record<string, any>;
}
