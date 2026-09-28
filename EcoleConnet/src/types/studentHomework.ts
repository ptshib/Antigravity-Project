// Fichier : src/types/studentHomework.ts
// Interfaces et parseur défensif pour les devoirs de l'élève (LOT 2K-T7-F)

export interface StudentHomeworkSummary {
  total: number;
  open: number;
  closed: number;
  overdue?: number;
  due_today?: number;
}

export interface StudentHomeworkItem {
  title: string;
  instructions: string;
  subject_name: string;
  teacher_name: string;
  assigned_on: string;
  due_at: string;
  estimated_minutes: number | null;
  is_closed: boolean;
}

export interface StudentHomeworkData {
  student_name: string;
  student_number: string;
  class_name: string;
  academic_year_name: string;
  summary: StudentHomeworkSummary;
  homework: StudentHomeworkItem[];
}

export type HomeworkTemporalStatus = 'upcoming' | 'due_today' | 'overdue' | 'closed';

export type HomeworkFilter = 'all' | 'upcoming' | 'due_today' | 'overdue' | 'closed';

export class StudentHomeworkError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'StudentHomeworkError';
    this.code = code;
  }
}

const FRENCH_MONTHS_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'
];

/**
 * Formate une date d'assignation en français (ex: "25 sept. 2026").
 * Gère défensivement les formats YYYY-MM-DD et ISO string sans décalage de fuseau horaire.
 */
export function formatHomeworkAssignedDate(rawDate: string): string {
  if (!rawDate || typeof rawDate !== 'string') return '';
  const trimmed = rawDate.trim();
  if (!trimmed) return '';

  // Match YYYY-MM-DD
  const pureDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (pureDateMatch) {
    const [, yStr, mStr, dStr] = pureDateMatch;
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const day = parseInt(dStr, 10);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const monthName = FRENCH_MONTHS_SHORT[month - 1];
      return `${day} ${monthName} ${year}`;
    }
  }

  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return trimmed;

  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const monthName = FRENCH_MONTHS_SHORT[month];

  return `${day} ${monthName} ${year}`;
}

/**
 * Formate une date et heure d'échéance en français (ex: "28 sept. 2026 à 10:00").
 * Affiche la date et l'heure de fin, sans caractères ISO (T, Z).
 */
export function formatHomeworkDueDate(rawDate: string): string {
  if (!rawDate || typeof rawDate !== 'string') return '';
  const trimmed = rawDate.trim();
  if (!trimmed) return '';

  // Match ISO string YYYY-MM-DDTHH:mm
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/i);
  if (isoMatch) {
    const [, yStr, mStr, dStr, hStr, minStr] = isoMatch;
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const day = parseInt(dStr, 10);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const monthName = FRENCH_MONTHS_SHORT[month - 1];
      return `${day} ${monthName} ${year} à ${hStr}:${minStr}`;
    }
  }

  // Fallback to Date object
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return trimmed;

  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const monthName = FRENCH_MONTHS_SHORT[month];
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');

  return `${day} ${monthName} ${year} à ${hours}:${minutes}`;
}


/**
 * Calcul déterministe du statut temporel d'un devoir par rapport à une date de référence (par défaut aujourd'hui).
 * Règle prioritaire absolue : is_closed = true -> 'closed' (Clôturé).
 */
export function computeHomeworkStatus(
  item: StudentHomeworkItem,
  referenceDate: Date = new Date()
): HomeworkTemporalStatus {
  if (item.is_closed) {
    return 'closed';
  }

  if (!item.due_at) {
    return 'upcoming';
  }

  const dueDate = new Date(item.due_at);
  if (isNaN(dueDate.getTime())) {
    return 'upcoming';
  }

  const dueTime = dueDate.getTime();
  const refTime = referenceDate.getTime();

  if (dueTime < refTime) {
    return 'overdue';
  }

  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth();
  const refDay = referenceDate.getDate();

  const dueYear = dueDate.getFullYear();
  const dueMonth = dueDate.getMonth();
  const dueDay = dueDate.getDate();

  const refZero = new Date(refYear, refMonth, refDay).getTime();
  const dueZero = new Date(dueYear, dueMonth, dueDay).getTime();

  if (dueZero === refZero) {
    return 'due_today';
  }

  return 'upcoming';
}

/**
 * Parseur défensif et strict du contrat JSON de public.get_authenticated_student_homework().
 */
export function parseStudentHomeworkData(raw: unknown): StudentHomeworkData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new StudentHomeworkError('Format de réponse invalide pour les devoirs.');
  }

  const obj = raw as Record<string, any>;

  if (!Array.isArray(obj.homework)) {
    throw new StudentHomeworkError('Format de liste de devoirs invalide.');
  }

  const summaryObj = (obj.summary && typeof obj.summary === 'object') ? obj.summary : {};

  const homeworkItems: StudentHomeworkItem[] = obj.homework.map((h: any, idx: number) => {
    if (!h || typeof h !== 'object' || Array.isArray(h)) {
      throw new StudentHomeworkError(`Devoir invalide à l'index ${idx}.`);
    }

    if (typeof h.title !== 'string' || !h.title.trim()) {
      throw new StudentHomeworkError(`Titre de devoir invalide ou absent à l'index ${idx}.`);
    }

    if (typeof h.instructions !== 'string') {
      throw new StudentHomeworkError(`Consignes de devoir invalides à l'index ${idx}.`);
    }

    if (typeof h.subject_name !== 'string' || !h.subject_name.trim()) {
      throw new StudentHomeworkError(`Matière de devoir invalide à l'index ${idx}.`);
    }

    if (typeof h.teacher_name !== 'string' || !h.teacher_name.trim()) {
      throw new StudentHomeworkError(`Enseignant de devoir invalide à l'index ${idx}.`);
    }

    if (typeof h.assigned_on !== 'string' || isNaN(Date.parse(h.assigned_on))) {
      throw new StudentHomeworkError(`Date d'assignation invalide à l'index ${idx}.`);
    }

    if (typeof h.due_at !== 'string' || isNaN(Date.parse(h.due_at))) {
      throw new StudentHomeworkError(`Date d'échéance invalide à l'index ${idx}.`);
    }

    if (typeof h.is_closed !== 'boolean') {
      throw new StudentHomeworkError(`Statut de clôture non booléen à l'index ${idx}.`);
    }

    if (
      h.estimated_minutes !== null &&
      (typeof h.estimated_minutes !== 'number' || isNaN(h.estimated_minutes) || h.estimated_minutes < 0)
    ) {
      throw new StudentHomeworkError(`Durée estimée invalide à l'index ${idx}.`);
    }

    return {
      title: h.title.trim(),
      instructions: h.instructions.trim(),
      subject_name: h.subject_name.trim(),
      teacher_name: h.teacher_name.trim(),
      assigned_on: h.assigned_on.trim(),
      due_at: h.due_at.trim(),
      estimated_minutes: h.estimated_minutes,
      is_closed: h.is_closed
    };
  });

  return {
    student_name: typeof obj.student_name === 'string' && obj.student_name.trim() ? obj.student_name.trim() : 'Élève',
    student_number: typeof obj.student_number === 'string' ? obj.student_number.trim() : '',
    class_name: typeof obj.class_name === 'string' ? obj.class_name.trim() : '',
    academic_year_name: typeof obj.academic_year_name === 'string' ? obj.academic_year_name.trim() : '',
    summary: {
      total: Number(summaryObj.total ?? homeworkItems.length),
      open: Number(summaryObj.open ?? homeworkItems.filter(i => !i.is_closed).length),
      closed: Number(summaryObj.closed ?? homeworkItems.filter(i => i.is_closed).length)
    },
    homework: homeworkItems
  };
}
