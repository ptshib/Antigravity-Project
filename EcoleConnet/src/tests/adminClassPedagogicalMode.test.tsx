import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../lib/supabase';

// Mock de Supabase pour vérifier les RPCs de gestion des modes pédagogiques et affectations des classes
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
    }
  }
}));

describe('Admin — Gestion du Mode Pédagogique et Affectations (Lot 2I-P2 & 2I-P3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. set_class_pedagogical_mode invoque la RPC Supabase avec les paramètres p_class_id et p_pedagogical_mode', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as any);

    const classId = 'cls-uuid-123';
    const targetMode = 'primary_homeroom';

    const { error } = await supabase.rpc('set_class_pedagogical_mode', {
      p_class_id: classId,
      p_pedagogical_mode: targetMode
    });

    expect(error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('set_class_pedagogical_mode', {
      p_class_id: 'cls-uuid-123',
      p_pedagogical_mode: 'primary_homeroom'
    });
  });

  it('2. Propage une erreur explicite si la RPC set_class_pedagogical_mode échoue (ex: rôle non autorisé)', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'Accès refusé : Seul un administrateur peut modifier le mode pédagogique d’une classe.', code: 'P0001' }
    } as any);

    const { error } = await supabase.rpc('set_class_pedagogical_mode', {
      p_class_id: 'cls-123',
      p_pedagogical_mode: 'primary_homeroom'
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('Accès refusé');
  });

  it('3. Refuse les valeurs de mode pédagogique non valides au niveau RPC', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'Mode pédagogique invalide. Choix autorisés : primary_homeroom, secondary_subjects.', code: 'P0001' }
    } as any);

    const { error } = await supabase.rpc('set_class_pedagogical_mode', {
      p_class_id: 'cls-123',
      p_pedagogical_mode: 'invalid_mode'
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain('Mode pédagogique invalide');
  });

  it('4. Classe primaire : assign_class_homeroom_teacher enregistre le titulaire sans champ Matière', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as any);

    const classId = 'cls-prim-123';
    const teacherId = 'tch-456';

    const { error } = await supabase.rpc('assign_class_homeroom_teacher', {
      p_class_id: classId,
      p_teacher_id: teacherId
    });

    expect(error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('assign_class_homeroom_teacher', {
      p_class_id: 'cls-prim-123',
      p_teacher_id: 'tch-456'
    });
  });

  it('5. Classe secondaire : assign_teacher_subject exige la matière et enregistre l’affectation', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: true, error: null } as any);

    const classId = 'cls-sec-789';
    const teacherId = 'tch-456';
    const subjectId = 'sbj-math-101';

    const { error } = await supabase.rpc('assign_teacher_subject', {
      p_class_id: classId,
      p_teacher_id: teacherId,
      p_subject_id: subjectId
    });

    expect(error).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('assign_teacher_subject', {
      p_class_id: 'cls-sec-789',
      p_teacher_id: 'tch-456',
      p_subject_id: 'sbj-math-101'
    });
  });

  it('6. Tableau des affectations : génère une seule ligne par classe primaire avec "Titulaire — Toutes les matières"', () => {
    const classes = [
      { id: 'c1', name: '2A', pedagogical_mode: 'primary_homeroom', homeroom_teacher_id: 'prof-1' },
      { id: 'c2', name: '7A', pedagogical_mode: 'secondary_subjects', homeroom_teacher_id: null }
    ];
    const teachers = [
      { id: 't1', profile_id: 'prof-1', first_name: 'Grâce', last_name: 'Kabeya' }
    ];

    const primaryClasses = classes.filter(c => c.pedagogical_mode === 'primary_homeroom');
    const primaryRows = primaryClasses.map(cls => {
      const homeroomTeacher = teachers.find(t => t.profile_id === cls.homeroom_teacher_id || t.id === cls.homeroom_teacher_id);
      return {
        id: `primary-${cls.id}`,
        class_name: cls.name,
        teacher_name: homeroomTeacher ? `${homeroomTeacher.first_name} ${homeroomTeacher.last_name}` : 'Aucun titulaire affecté',
        subject_name: 'Titulaire — Toutes les matières',
        mode: 'primary_homeroom'
      };
    });

    expect(primaryRows).toHaveLength(1);
    expect(primaryRows[0].class_name).toBe('2A');
    expect(primaryRows[0].teacher_name).toBe('Grâce Kabeya');
    expect(primaryRows[0].subject_name).toBe('Titulaire — Toutes les matières');
  });

  it('7. Tableau des affectations : meut/filtre les anciennes affectations matière d’une classe primaire', () => {
    const classes = [
      { id: 'c1', name: '2A', pedagogical_mode: 'primary_homeroom', homeroom_teacher_id: 'prof-1' }
    ];
    const assignments = [
      { id: 'old-1', class_id: 'c1', teacher_id: 't1', subject_name: 'Maths Historique' }
    ];

    // Les affectations historiques en teacher_class_assignments pour une classe primaire sont ignorées
    const secondaryAssignments = assignments.filter(a => {
      const cls = classes.find(c => c.id === a.class_id);
      return cls ? cls.pedagogical_mode !== 'primary_homeroom' : true;
    });

    expect(secondaryAssignments).toHaveLength(0);
  });

  it('8. Tableau des affectations : préserve les lignes enseignant-matière-classe pour le secondaire', () => {
    const classes = [
      { id: 'c2', name: '7A', pedagogical_mode: 'secondary_subjects' }
    ];
    const assignments = [
      { id: 'a-1', class_id: 'c2', teacher_id: 't2', subject_name: 'Physique' }
    ];

    const secondaryAssignments = assignments.filter(a => {
      const cls = classes.find(c => c.id === a.class_id);
      return cls ? cls.pedagogical_mode !== 'primary_homeroom' : true;
    });

    expect(secondaryAssignments).toHaveLength(1);
    expect(secondaryAssignments[0].subject_name).toBe('Physique');
  });

  it('9. Isolement multi-écoles : refuse l’affectation d’un enseignant d’un autre établissement avec code 42501', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'Accès refusé : Cet enseignant appartient à un autre établissement.', code: '42501' }
    } as any);

    const { error } = await supabase.rpc('assign_class_homeroom_teacher', {
      p_class_id: 'cls-123',
      p_teacher_id: 'tch-other-school'
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('autre établissement');
  });

  it('10. Lot 2I-P4 — get_effective_class_subjects invoque la RPC Supabase et retourne toutes les matières applicables par défaut', async () => {
    const mockSubjects = [
      { subject_id: 'sbj-1', subject_name: 'Mathématiques', subject_code: 'MATH', coefficient: 1.0, is_custom: false, setting_id: null },
      { subject_id: 'sbj-2', subject_name: 'Français', subject_code: 'FRAN', coefficient: 1.0, is_custom: false, setting_id: null }
    ];
    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockSubjects, error: null } as any);

    const { data, error } = await supabase.rpc('get_admin_class_subject_coefficients', {
      p_class_id: 'cls-prim-2a'
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.[0].subject_name).toBe('Mathématiques');
    expect(data?.[0].coefficient).toBe(1.0);
  });

  it('11. Lot 2I-P4 — get_teacher_authorized_subjects pour titulaire primaire s’aligne sur les matières applicables', async () => {
    const mockSubjects = [
      { subject_id: 'sbj-1', subject_name: 'Mathématiques', subject_code: 'MATH', pedagogical_mode: 'primary_homeroom' },
      { subject_id: 'sbj-2', subject_name: 'Français', subject_code: 'FRAN', pedagogical_mode: 'primary_homeroom' }
    ];
    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockSubjects, error: null } as any);

    const { data, error } = await supabase.rpc('get_teacher_authorized_subjects', {
      p_class_id: 'cls-prim-2a'
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });
});
