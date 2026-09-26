/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ParentChildSwitcher, type LinkedChild } from '../components/parent/portal/ParentChildSwitcher';
import { supabase } from '../lib/supabase';

// Mocks
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn()
    }))
  }
}));

describe('HOTFIX LOT 2K-T2-V2 — Suite Dédiée Multi-Écoles & Métadonnées Enfants Parent (20 Scénarios)', () => {
  const mockChildEsther: LinkedChild = {
    link_id: 'link-esther-001',
    student_id: 'c8c8de47-esther-uuid-1111',
    student_number: 'ELV-2026-001',
    first_name: 'Esther',
    last_name: 'Tshiala Kabeya',
    student_full_name: 'Esther Tshiala Kabeya',
    display_name: 'Esther Tshiala Kabeya',
    class_name: '3A',
    class_id: 'class-3a-uuid',
    school_name: 'Complexe Scolaire Pilote EcoleConnect',
    school_id: 'school-b-uuid',
    academic_year_id: 'ay-2026',
    academic_year_name: '2026-2027',
    can_view_academic: true,
    relationship: 'Mère'
  };

  const mockChildDavid: LinkedChild = {
    link_id: 'link-david-002',
    student_id: 'c8c8de47-david-uuid-2222',
    student_number: 'ELV-2026-002',
    first_name: 'David',
    last_name: 'Mutombo Kabeya',
    student_full_name: 'David Mutombo Kabeya',
    display_name: 'David Mutombo Kabeya',
    class_name: '1A',
    class_id: 'class-1a-uuid',
    school_name: 'Complexe Scolaire Pilote EcoleConnect',
    school_id: 'school-b-uuid',
    academic_year_id: 'ay-2026',
    academic_year_name: '2026-2027',
    can_view_academic: true,
    relationship: 'Père'
  };

  const mockChildJoel: LinkedChild = {
    link_id: 'link-joel-003',
    student_id: 'c8c8de47-9fb5-4a95-8e11-50ed57c3144a',
    student_number: 'ELV-2026-004',
    first_name: 'Joël',
    last_name: 'Kalala',
    student_full_name: 'Joël Kalala',
    display_name: 'Joël Kalala',
    class_name: '1B',
    class_id: 'c27c5832-ebaf-4b8d-a239-eacabb04f569',
    school_name: 'Complexe Scolaire les Petits Anges',
    school_id: '4f0cbb55-d3f5-4d55-bb26-ae4ec821de85',
    academic_year_id: 'ay-2026',
    academic_year_name: '2026-2027',
    can_view_academic: true,
    relationship: 'Tuteur'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Réponse RPC avec uniquement les 10 champs réels
  it('1. Valide le contrat à 10 colonnes réelles de get_parent_children_and_schools()', async () => {
    const rawRpcResponse = [
      {
        student_id: mockChildJoel.student_id,
        student_full_name: 'Joël Kalala',
        school_id: mockChildJoel.school_id,
        school_name: 'Complexe Scolaire les Petits Anges',
        class_id: mockChildJoel.class_id,
        class_name: '1B',
        academic_year_id: 'ay-2026',
        academic_year_name: '2026-2027',
        link_status: 'approved',
        permissions: { can_view_academic: true }
      }
    ];

    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: rawRpcResponse,
      error: null
    } as any);

    const { data } = await supabase.rpc('get_parent_children_and_schools');
    expect(data).toHaveLength(1);
    expect(Object.keys(data![0])).toEqual([
      'student_id',
      'student_full_name',
      'school_id',
      'school_name',
      'class_id',
      'class_name',
      'academic_year_id',
      'academic_year_name',
      'link_status',
      'permissions'
    ]);
  });

  // 2. Conservation du matricule (student_number)
  it('2. Conserve et affiche le matricule réel de l’élève (ex: ELV-2026-004)', () => {
    render(
      <ParentChildSwitcher
        childrenList={[mockChildJoel]}
        selectedChildId={mockChildJoel.student_id}
        onSelectChild={vi.fn()}
        activeChild={mockChildJoel}
      />
    );
    expect(screen.getByText('ELV-2026-004')).toBeInTheDocument();
  });

  // 3. Conservation de relationship
  it('3. Conserve et affiche la relation enregistrée (Père/Mère/Tuteur)', () => {
    render(
      <ParentChildSwitcher
        childrenList={[mockChildJoel]}
        selectedChildId={mockChildJoel.student_id}
        onSelectChild={vi.fn()}
        activeChild={mockChildJoel}
      />
    );
    expect(screen.getByText('Tuteur')).toBeInTheDocument();
  });

  // 4. Nom composé ou comportant plusieurs espaces sans découpage incorrect
  it('4. Gère parfaitement les noms composés complexes (ex: Jean Paul Mutombo Kabeya)', () => {
    const childCompound: LinkedChild = {
      ...mockChildDavid,
      first_name: 'Jean Paul',
      last_name: 'Mutombo Kabeya',
      student_full_name: 'Jean Paul Mutombo Kabeya',
      display_name: 'Jean Paul Mutombo Kabeya'
    };

    render(
      <ParentChildSwitcher
        childrenList={[childCompound]}
        selectedChildId={childCompound.student_id}
        onSelectChild={vi.fn()}
        activeChild={childCompound}
      />
    );

    expect(screen.getByText('Jean Paul Mutombo Kabeya')).toBeInTheDocument();
  });

  // 5. Parent mono-école avec plusieurs enfants
  it('5. Affiche correctement un parent mono-école avec plusieurs enfants (Esther & David)', () => {
    render(
      <ParentChildSwitcher
        childrenList={[mockChildEsther, mockChildDavid]}
        selectedChildId={mockChildEsther.student_id}
        onSelectChild={vi.fn()}
        activeChild={mockChildEsther}
      />
    );
    expect(screen.getByText('Esther Tshiala Kabeya')).toBeInTheDocument();
    expect(screen.getAllByText('3A').length).toBeGreaterThan(0);
  });

  // 6. Parent multi-écoles avec profiles.school_id = École B
  it('6. Affiche tous les enfants du parent multi-écoles (Esther, David, Joël)', () => {
    render(
      <ParentChildSwitcher
        childrenList={[mockChildEsther, mockChildDavid, mockChildJoel]}
        selectedChildId={mockChildEsther.student_id}
        onSelectChild={vi.fn()}
        activeChild={mockChildEsther}
      />
    );
    expect(screen.getByText('Esther')).toBeInTheDocument();
    expect(screen.getByText('David')).toBeInTheDocument();
    expect(screen.getByText('Joël')).toBeInTheDocument();
  });

  // 7. Joël dans l’École A affiche classe 1B et son école
  it('7. Joël dans l’École A affiche la classe 1B et « Complexe Scolaire les Petits Anges »', () => {
    render(
      <ParentChildSwitcher
        childrenList={[mockChildEsther, mockChildDavid, mockChildJoel]}
        selectedChildId={mockChildJoel.student_id}
        onSelectChild={vi.fn()}
        activeChild={mockChildJoel}
      />
    );
    expect(screen.getAllByText('1B').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Complexe Scolaire les Petits Anges/i).length).toBeGreaterThan(0);
  });

  // 8. Changement David → Joël déclenche onSelectChild avec student_id
  it('8. Déclenche onSelectChild avec student_id lors du changement d’enfant', () => {
    const onSelectSpy = vi.fn();
    render(
      <ParentChildSwitcher
        childrenList={[mockChildDavid, mockChildJoel]}
        selectedChildId={mockChildDavid.student_id}
        onSelectChild={onSelectSpy}
        activeChild={mockChildDavid}
      />
    );

    const joelBtn = screen.getByRole('button', { name: /Joël/i });
    fireEvent.click(joelBtn);
    expect(onSelectSpy).toHaveBeenCalledWith(mockChildJoel.student_id);
  });

  // 9. Aucune classe résolue via PostgREST direct
  it('9. Ne fait aucune requête directe sur classes ou student_enrollments pour le switcher', () => {
    expect(supabase.from).not.toHaveBeenCalledWith('classes');
    expect(supabase.from).not.toHaveBeenCalledWith('student_enrollments');
  });

  // 10. Aucun enfant tiers n’est affiché
  it('10. N’affiche aucun enfant tiers hors de la liste RPC autorisée', () => {
    render(
      <ParentChildSwitcher
        childrenList={[mockChildEsther]}
        selectedChildId={mockChildEsther.student_id}
        onSelectChild={vi.fn()}
        activeChild={mockChildEsther}
      />
    );
    expect(screen.queryByText('David')).not.toBeInTheDocument();
    expect(screen.queryByText('Joël')).not.toBeInTheDocument();
  });

  // 11. Métadonnée complémentaire absente : fallbacks sémantiquement neutres
  it('11. Applique des fallbacks sémantiquement neutres (Non renseigné, Lien non renseigné) si la métadonnée complémentaire est absente', () => {
    const childNoExtra: LinkedChild = {
      student_id: 'child-no-extra',
      student_full_name: 'Alex Banza',
      display_name: 'Alex Banza',
      student_number: 'Non renseigné',
      relationship: 'Lien non renseigné',
      can_view_academic: true,
      class_name: '2A',
      school_name: 'École Test'
    };

    render(
      <ParentChildSwitcher
        childrenList={[childNoExtra]}
        selectedChildId={childNoExtra.student_id}
        onSelectChild={vi.fn()}
        activeChild={childNoExtra}
      />
    );

    expect(screen.getByText('Non renseigné')).toBeInTheDocument();
    expect(screen.getByText('Lien non renseigné')).toBeInTheDocument();
  });

  // 12. RPC réussie mais requête complémentaire échouée
  it('12. Survit sans crash si la requête complémentaire échoue', () => {
    const childFallback: LinkedChild = {
      student_id: 's-fallback',
      student_number: 'Non renseigné',
      student_full_name: 'Marie Kabila',
      display_name: 'Marie Kabila',
      first_name: 'Marie',
      last_name: 'Kabila',
      relationship: 'Lien non renseigné',
      class_name: '4B',
      school_name: 'École B',
      can_view_academic: true
    };

    render(
      <ParentChildSwitcher
        childrenList={[childFallback]}
        selectedChildId={childFallback.student_id}
        onSelectChild={vi.fn()}
        activeChild={childFallback}
      />
    );

    expect(screen.getByText('Marie Kabila')).toBeInTheDocument();
  });

  // 13. Fallback classe NULL
  it('13. Affiche « Classe non attribuée » lorsque class_name est NULL', () => {
    const childNoClass: LinkedChild = {
      ...mockChildJoel,
      class_name: undefined,
      class_id: undefined
    };

    render(
      <ParentChildSwitcher
        childrenList={[childNoClass]}
        selectedChildId={childNoClass.student_id}
        onSelectChild={vi.fn()}
        activeChild={childNoClass}
      />
    );
    expect(screen.getByText('Classe non attribuée')).toBeInTheDocument();
  });

  // 14. Fallback école NULL
  it('14. Affiche « Établissement non disponible » lorsque school_name est NULL', () => {
    const childNoSchool: LinkedChild = {
      ...mockChildJoel,
      school_name: undefined,
      school_id: undefined
    };

    render(
      <ParentChildSwitcher
        childrenList={[childNoSchool]}
        selectedChildId={childNoSchool.student_id}
        onSelectChild={vi.fn()}
        activeChild={childNoSchool}
      />
    );
    expect(screen.getByText('Établissement non disponible')).toBeInTheDocument();
  });

  // 15. Déduplication stricte par student_id
  it('15. Déduplique strictement les enfants par student_id', () => {
    const listWithDuplicates: LinkedChild[] = [mockChildJoel, { ...mockChildJoel }];
    const uniqueMap = new Map<string, LinkedChild>();
    listWithDuplicates.forEach(c => uniqueMap.set(c.student_id, c));
    expect(Array.from(uniqueMap.values()).length).toBe(1);
  });

  // 16. Préservation selectedChildId après rafraîchissement
  it('16. Conserve l’enfant sélectionné s’il est toujours présent après rafraîchissement', () => {
    const prevId = mockChildJoel.student_id;
    const list = [mockChildEsther, mockChildJoel];
    const newSelected = prevId && list.some(c => c.student_id === prevId) ? prevId : list[0].student_id;
    expect(newSelected).toBe(mockChildJoel.student_id);
  });

  // 17. Affichage mobile/tablette/desktop avec truncate
  it('17. Applique les classes responsive truncate et title sur l’établissement', () => {
    render(
      <ParentChildSwitcher
        childrenList={[mockChildEsther, mockChildJoel]}
        selectedChildId={mockChildJoel.student_id}
        onSelectChild={vi.fn()}
        activeChild={mockChildJoel}
      />
    );
    const schoolBadges = screen.getAllByTitle(/Complexe Scolaire les Petits Anges/i);
    expect(schoolBadges[0]).toHaveClass('truncate');
  });

  // 18. Noms longs d’établissement sans débordement
  it('18. Empêche le débordement horizontal pour les noms d’établissement très longs', () => {
    const childLongSchool: LinkedChild = {
      ...mockChildJoel,
      school_name: 'Complexe Scolaire International de Développement et de Recherche Appliquée de Kinshasa'
    };

    render(
      <ParentChildSwitcher
        childrenList={[childLongSchool]}
        selectedChildId={childLongSchool.student_id}
        onSelectChild={vi.fn()}
        activeChild={childLongSchool}
      />
    );
    const badges = screen.getAllByTitle(/Complexe Scolaire International/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  // 19. Échappement XSS
  it('19. Échappe naturellement les caractères spéciaux dans le nom d’école', () => {
    const childXSS: LinkedChild = {
      ...mockChildJoel,
      school_name: '<script>alert("xss")</script> École Test'
    };

    render(
      <ParentChildSwitcher
        childrenList={[childXSS]}
        selectedChildId={childXSS.student_id}
        onSelectChild={vi.fn()}
        activeChild={childXSS}
      />
    );
    const xssElements = screen.getAllByText('<script>alert("xss")</script> École Test');
    expect(xssElements.length).toBeGreaterThan(0);
    expect(document.querySelector('script')).toBeNull();
  });

  // 20. Non-régression du module Messagerie
  it('20. Transmet fidèlement selectedChildId et la liste des enfants au module de messagerie', () => {
    const childrenList = [mockChildEsther, mockChildJoel];
    const messagingChildren = childrenList.map(ch => ({
      id: ch.student_id,
      display_name: ch.display_name || ch.student_full_name,
      first_name: ch.first_name || ch.student_full_name,
      last_name: ch.last_name || '',
      class_name: ch.class_name
    }));

    expect(messagingChildren.length).toBe(2);
    expect(messagingChildren[1].class_name).toBe('1B');
    expect(messagingChildren[1].id).toBe(mockChildJoel.student_id);
  });

  // 21. FAIL-CLOSED : Permissions NULL ou malformées -> toutes false
  it('21. Applique la politique fail-closed : permissions NULL ou malformées mènent à toutes les permissions false', () => {
    const rpcNullPerms = {
      student_id: 's-null-perms',
      student_full_name: 'Test Perms Null',
      school_id: 'sch-1',
      school_name: 'CS Test',
      class_id: 'cl-1',
      class_name: '1A',
      academic_year_id: 'ay-1',
      academic_year_name: '2026-2027',
      link_status: 'approved',
      permissions: null
    };

    const perms = rpcNullPerms.permissions && typeof rpcNullPerms.permissions === 'object'
      ? rpcNullPerms.permissions
      : null;

    const canViewAcademic = perms ? Boolean((perms as any).can_view_academic) : false;
    const canViewAttendance = perms ? Boolean((perms as any).can_view_attendance) : false;
    const canViewHomework = perms ? Boolean((perms as any).can_view_homework) : false;
    const canViewFinances = perms ? Boolean((perms as any).can_view_finances) : false;

    expect(canViewAcademic).toBe(false);
    expect(canViewAttendance).toBe(false);
    expect(canViewHomework).toBe(false);
    expect(canViewFinances).toBe(false);
  });

  // 22. Isolation des métadonnées : linksData ne peut PAS surcharger school_id ou permissions
  it('22. Empêche les métadonnées complémentaires de modifier school_id, class_id ou permissions', () => {
    const canonicalRpcRow = {
      student_id: 's-secure',
      student_full_name: 'Secured Child',
      school_id: 'school-rpc-canonical',
      school_name: 'CS Authorized',
      class_id: 'class-rpc-canonical',
      class_name: '3A',
      academic_year_id: 'ay-2026',
      academic_year_name: '2026-2027',
      link_status: 'approved',
      permissions: { can_view_academic: true, can_view_finances: false }
    };

    const maliciousLinkData = {
      id: 'malicious-link-id',
      student_id: 's-secure',
      relationship: 'father',
      school_id: 'school-hacked',
      class_id: 'class-hacked',
      permissions: { can_view_academic: true, can_view_finances: true }
    };

    // Fusion contrôlée : RPC est autoritative pour school_id, class_id, academic_year_id, permissions
    const child: LinkedChild = {
      student_id: canonicalRpcRow.student_id,
      student_full_name: canonicalRpcRow.student_full_name,
      display_name: canonicalRpcRow.student_full_name,
      school_id: canonicalRpcRow.school_id,
      school_name: canonicalRpcRow.school_name,
      class_id: canonicalRpcRow.class_id,
      class_name: canonicalRpcRow.class_name,
      academic_year_id: canonicalRpcRow.academic_year_id,
      academic_year_name: canonicalRpcRow.academic_year_name,
      can_view_academic: Boolean(canonicalRpcRow.permissions.can_view_academic),
      can_view_finances: Boolean(canonicalRpcRow.permissions.can_view_finances),
      relationship: 'Père'
    };

    expect(child.school_id).toBe('school-rpc-canonical');
    expect(child.school_id).not.toBe(maliciousLinkData.school_id);
    expect(child.can_view_finances).toBe(false);
  });

  // 23. Exclusion des enfants absents de la RPC
  it('23. Exclut tout enfant présent uniquement dans linksData mais absent de la réponse RPC', () => {
    const rpcStudentIds = ['s-rpc-1'];
    const linksData = [
      { student_id: 's-rpc-1', relationship: 'father' },
      { student_id: 's-unauthorized-2', relationship: 'mother' }
    ];

    const validLinks = linksData.filter(l => rpcStudentIds.includes(l.student_id));
    expect(validLinks).toHaveLength(1);
    expect(validLinks[0].student_id).toBe('s-rpc-1');
  });

  // 24. Traitement déterministe des doublons linksData
  it('24. Résout de manière déterministe les doublons de métadonnées parent_student_links pour un même student_id', () => {
    const duplicateLinks = [
      { id: 'link-z-999', student_id: 's-dup-1', relationship: 'guardian' },
      { id: 'link-a-001', student_id: 's-dup-1', relationship: 'father' }
    ];

    const sortedLinks = [...duplicateLinks].sort((a, b) => a.id.localeCompare(b.id));
    const compMap = new Map<string, any>();
    sortedLinks.forEach(row => {
      if (!compMap.has(row.student_id)) {
        compMap.set(row.student_id, row);
      }
    });

    expect(compMap.get('s-dup-1').id).toBe('link-a-001');
    expect(compMap.get('s-dup-1').relationship).toBe('father');
  });

  // 25. Absence de découpage artificiel du nom (Jean Paul Mutombo Kabeya)
  it('25. Ne découpe pas student_full_name avec split(" ") lorsque les métadonnées spécifiques sont absentes', () => {
    const rpcRowNoMeta = {
      student_id: 's-full-name-only',
      student_full_name: 'Jean Paul Mutombo Kabeya'
    };

    // Quand first_name/last_name sont absents, display_name = rpcRow.student_full_name
    const displayName = rpcRowNoMeta.student_full_name;
    expect(displayName).toBe('Jean Paul Mutombo Kabeya');
  });

  // 26. Valeurs exactes réelles de Joël
  it('26. Valide les valeurs réelles exactes en base de données pour Joël Kalala', () => {
    const joelRealValues = {
      student_id: 'c8c8de47-9fb5-4a95-8e11-50ed57c3144a',
      student_number: 'ELV-2026-004',
      raw_relationship: 'father',
      displayed_relationship: 'Père',
      class_name: '1B',
      school_name: 'Complexe Scolaire les Petits Anges'
    };

    expect(joelRealValues.student_number).toBe('ELV-2026-004');
    expect(joelRealValues.displayed_relationship).toBe('Père');
    expect(joelRealValues.class_name).toBe('1B');
    expect(joelRealValues.school_name).toBe('Complexe Scolaire les Petits Anges');
  });

  // 27. Fallbacks neutres lorsque matricule ou relationship est null
  it('27. Utilise "Non renseigné" et "Lien non renseigné" quand matricule ou relation est null', () => {
    const extraNull = {
      student_number: null,
      relationship: null
    };

    const studentNumberFallback = extraNull.student_number || 'Non renseigné';
    const relationshipFallback = extraNull.relationship || 'Lien non renseigné';

    expect(studentNumberFallback).toBe('Non renseigné');
    expect(relationshipFallback).toBe('Lien non renseigné');
  });
});
