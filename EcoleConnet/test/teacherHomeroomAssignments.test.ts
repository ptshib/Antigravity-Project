// test/teacherHomeroomAssignments.test.ts
// Execution: deno test test/teacherHomeroomAssignments.test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

export interface ClassRow {
  id: string;
  name: string;
  homeroom_teacher_id: string | null;
  is_active?: boolean;
}

export interface TeacherAssignmentRow {
  id: string;
  class_id: string;
  teacher_id: string;
  subject_id: string | null;
  subject_name?: string;
  is_active: boolean;
}

export interface GroupedAssignmentResult {
  id: string;
  class_id: string;
  class_name: string;
  is_homeroom: boolean;
  subject_id: string | null;
  subjects: string[];
  subject_name: string;
}

export function buildTeacherGroupedAssignments(
  profileId: string,
  teacherId: string,
  classesList: ClassRow[],
  assignmentsList: TeacherAssignmentRow[]
): GroupedAssignmentResult[] {
  const classGroupMap = new Map<string, GroupedAssignmentResult>();

  // 1. Classes dont l'enseignant est professeur titulaire (homeroom_teacher_id === profileId)
  const homeroomClasses = classesList.filter(
    c => c.is_active !== false && c.homeroom_teacher_id === profileId
  );

  homeroomClasses.forEach(c => {
    classGroupMap.set(c.id, {
      id: `homeroom-${c.id}`,
      class_id: c.id,
      class_name: c.name,
      is_homeroom: true,
      subject_id: null,
      subjects: [],
      subject_name: 'Titularisation (Appel Général)'
    });
  });

  // 2. Fusionner avec les affectations de matières actives dans teacher_class_assignments
  const myAssignments = assignmentsList.filter(
    a => a.teacher_id === teacherId && a.is_active
  );

  myAssignments.forEach(a => {
    const cls = classesList.find(c => c.id === a.class_id);
    const clsName = cls?.name || 'Classe inconnue';
    const sbjName = a.subject_name || 'Appel Général';

    if (!classGroupMap.has(a.class_id)) {
      classGroupMap.set(a.class_id, {
        id: a.id,
        class_id: a.class_id,
        class_name: clsName,
        is_homeroom: false,
        subject_id: a.subject_id || null,
        subjects: sbjName ? [sbjName] : [],
        subject_name: sbjName
      });
    } else {
      const existing = classGroupMap.get(a.class_id)!;
      if (sbjName && sbjName !== 'Appel Général') {
        if (!existing.subjects.includes(sbjName)) {
          existing.subjects.push(sbjName);
        }
        existing.subject_name = existing.subjects.join(', ');
      }
    }
  });

  return Array.from(classGroupMap.values());
}

// --- SUITE DE TESTS DENO ---

Deno.test('Homeroom Teacher Only: displays class with is_homeroom = true and count = 1', () => {
  const profileId = 'prof-chantal-uuid';
  const teacherId = 'tch-chantal-uuid';

  const classes: ClassRow[] = [
    { id: 'class-1a', name: '1A', homeroom_teacher_id: profileId, is_active: true },
    { id: 'class-2a', name: '2A', homeroom_teacher_id: 'other-profile', is_active: true }
  ];

  const assignments: TeacherAssignmentRow[] = [];

  const grouped = buildTeacherGroupedAssignments(profileId, teacherId, classes, assignments);

  assertEquals(grouped.length, 1);
  assertEquals(grouped[0].class_id, 'class-1a');
  assertEquals(grouped[0].class_name, '1A');
  assertEquals(grouped[0].is_homeroom, true);
  assertEquals(grouped[0].subject_name, 'Titularisation (Appel Général)');
});

Deno.test('Subject Assignment Only: displays class with is_homeroom = false', () => {
  const profileId = 'prof-didier-uuid';
  const teacherId = 'tch-didier-uuid';

  const classes: ClassRow[] = [
    { id: 'class-3a', name: '3A', homeroom_teacher_id: 'other-profile', is_active: true }
  ];

  const assignments: TeacherAssignmentRow[] = [
    { id: 'assign-1', class_id: 'class-3a', teacher_id: teacherId, subject_id: 'sbj-math', subject_name: 'Mathématiques', is_active: true }
  ];

  const grouped = buildTeacherGroupedAssignments(profileId, teacherId, classes, assignments);

  assertEquals(grouped.length, 1);
  assertEquals(grouped[0].class_id, 'class-3a');
  assertEquals(grouped[0].is_homeroom, false);
  assertEquals(grouped[0].subject_name, 'Mathématiques');
});

Deno.test('Combination Homeroom + Subject in same class: no duplicates, is_homeroom = true and subject name merged', () => {
  const profileId = 'prof-grace-uuid';
  const teacherId = 'tch-grace-uuid';

  const classes: ClassRow[] = [
    { id: 'class-2a', name: '2A', homeroom_teacher_id: profileId, is_active: true }
  ];

  const assignments: TeacherAssignmentRow[] = [
    { id: 'assign-2', class_id: 'class-2a', teacher_id: teacherId, subject_id: 'sbj-french', subject_name: 'Français', is_active: true }
  ];

  const grouped = buildTeacherGroupedAssignments(profileId, teacherId, classes, assignments);

  // Must have exactly 1 card (no duplicates)
  assertEquals(grouped.length, 1);
  assertEquals(grouped[0].class_id, 'class-2a');
  assertEquals(grouped[0].is_homeroom, true);
  assertEquals(grouped[0].subject_name, 'Français');
});

Deno.test('Multiple classes (Homeroom in 1A, Subject in 2B): correctly lists both classes', () => {
  const profileId = 'prof-multi-uuid';
  const teacherId = 'tch-multi-uuid';

  const classes: ClassRow[] = [
    { id: 'class-1a', name: '1A', homeroom_teacher_id: profileId, is_active: true },
    { id: 'class-2b', name: '2B', homeroom_teacher_id: 'other-profile', is_active: true }
  ];

  const assignments: TeacherAssignmentRow[] = [
    { id: 'assign-3', class_id: 'class-2b', teacher_id: teacherId, subject_id: 'sbj-bio', subject_name: 'Biologie', is_active: true }
  ];

  const grouped = buildTeacherGroupedAssignments(profileId, teacherId, classes, assignments);

  assertEquals(grouped.length, 2);

  const c1a = grouped.find(g => g.class_id === 'class-1a');
  assertEquals(c1a?.is_homeroom, true);
  assertEquals(c1a?.subject_name, 'Titularisation (Appel Général)');

  const c2b = grouped.find(g => g.class_id === 'class-2b');
  assertEquals(c2b?.is_homeroom, false);
  assertEquals(c2b?.subject_name, 'Biologie');
});
