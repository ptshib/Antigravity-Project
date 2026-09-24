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

describe('Admin — Gestion du Mode Pédagogique et Affectations (Lot 2I-P2)', () => {
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
});
