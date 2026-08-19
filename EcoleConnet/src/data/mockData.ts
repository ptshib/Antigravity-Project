import type {
  User,
  Student,
  Parent,
  Teacher,
  SchoolClass,
  Announcement,
  AppNotification,
  AttendanceRecord,
  Homework,
  GradeRecord,
  TimetableSlot,
  SchoolEvent,
  PaymentRecord,
  SchoolDocument,
  Conversation,
  Message
} from '../types';

export const SCHOOL_INFO = {
  name: 'Complexe Scolaire Les Horizons',
  slogan: 'L’excellence éducative au service de la jeunesse',
  academicYear: '2026–2027',
  phone: '+243 819 883 084',
  whatsapp: '+420 776 308 018',
  email: 'contact@leshorizons-ecole.cd',
  provider: 'PaTShi-Digital'
};

// Demo Users
export const DEMO_USERS: Record<string, User> = {
  admin: {
    id: 'usr_admin_1',
    name: 'M. Dieudonné Mukendi',
    email: 'admin@leshorizons-ecole.cd',
    role: 'admin',
    avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80',
    phone: '+243 819 883 084',
    schoolName: SCHOOL_INFO.name,
    academicYear: SCHOOL_INFO.academicYear
  },
  teacher: {
    id: 'usr_teach_1',
    name: 'Mme. Clarisse Mbuyi',
    email: 'c.mbuyi@leshorizons-ecole.cd',
    role: 'teacher',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    phone: '+243 820 112 334',
    schoolName: SCHOOL_INFO.name,
    academicYear: SCHOOL_INFO.academicYear
  },
  parent: {
    id: 'usr_parent_1',
    name: 'Mme. Marie Kabedi',
    email: 'm.kabedi@gmail.com',
    role: 'parent',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    phone: '+243 998 765 432',
    schoolName: SCHOOL_INFO.name,
    academicYear: SCHOOL_INFO.academicYear
  },
  student: {
    id: 'usr_stud_1',
    name: 'Marc Kabedi',
    email: 'marc.kabedi@leshorizons-ecole.cd',
    role: 'student',
    avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
    phone: '+243 891 234 567',
    schoolName: SCHOOL_INFO.name,
    academicYear: SCHOOL_INFO.academicYear
  }
};

// Demo Parent Children
export const DEMO_CHILDREN: Student[] = [
  {
    id: 'stud_1',
    userId: 'usr_stud_1',
    firstName: 'Marc',
    lastName: 'Kabedi',
    matricule: 'HOR-2026-0142',
    classId: 'cls_1sec_a',
    className: '1re Secondaire A',
    parentId: 'usr_parent_1',
    dateOfBirth: '2013-05-14',
    gender: 'M',
    avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
    overallAverage: 84.5
  },
  {
    id: 'stud_2',
    userId: 'usr_stud_2',
    firstName: 'Grace',
    lastName: 'Kabedi',
    matricule: 'HOR-2026-0288',
    classId: 'cls_6prim_b',
    className: '6e Primaire B',
    parentId: 'usr_parent_1',
    dateOfBirth: '2015-11-20',
    gender: 'F',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    overallAverage: 91.2
  }
];

export const MOCK_CLASSES: SchoolClass[] = [
  { id: 'cls_6prim_a', name: '6e Primaire A', level: 'Primaire', mainTeacherId: 'teach_2', mainTeacherName: 'M. Jean Kasongo', studentCount: 32, room: 'Local P-06' },
  { id: 'cls_6prim_b', name: '6e Primaire B', level: 'Primaire', mainTeacherId: 'teach_3', mainTeacherName: 'Mme. Sarah Tshilombo', studentCount: 30, room: 'Local P-07' },
  { id: 'cls_1sec_a', name: '1re Secondaire A', level: 'Secondaire', mainTeacherId: 'teach_1', mainTeacherName: 'Mme. Clarisse Mbuyi', studentCount: 35, room: 'Local S-101' },
  { id: 'cls_1sec_b', name: '1re Secondaire B', level: 'Secondaire', mainTeacherId: 'teach_4', mainTeacherName: 'M. Patrick Ilunga', studentCount: 34, room: 'Local S-102' },
  { id: 'cls_2sec_a', name: '2e Secondaire A', level: 'Secondaire', mainTeacherId: 'teach_5', mainTeacherName: 'Mme. Naomie Koko', studentCount: 29, room: 'Local S-201' },
  { id: 'cls_2sec_b', name: '2e Secondaire B', level: 'Secondaire', mainTeacherId: 'teach_6', mainTeacherName: 'M. Eric Banza', studentCount: 31, room: 'Local S-202' },
  { id: 'cls_3sec_a', name: '3e Secondaire A', level: 'Secondaire', mainTeacherId: 'teach_7', mainTeacherName: 'Mme. Patricia Mwamba', studentCount: 28, room: 'Local S-301' },
  { id: 'cls_3sec_b', name: '3e Secondaire B', level: 'Secondaire', mainTeacherId: 'teach_8', mainTeacherName: 'M. Joseph Ntumba', studentCount: 27, room: 'Local S-302' },
];

export const MOCK_TEACHERS: Teacher[] = [
  { id: 'teach_1', userId: 'usr_teach_1', firstName: 'Clarisse', lastName: 'Mbuyi', email: 'c.mbuyi@leshorizons-ecole.cd', phone: '+243 820 112 334', subjects: ['Mathématiques', 'Physique-Chimie'], classes: ['1re Secondaire A', '2e Secondaire A'], avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80' },
  { id: 'teach_2', userId: 'usr_teach_2', firstName: 'Jean', lastName: 'Kasongo', email: 'j.kasongo@leshorizons-ecole.cd', phone: '+243 811 223 344', subjects: ['Français', 'Littérature'], classes: ['6e Primaire A', '1re Secondaire B'], avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
  { id: 'teach_3', userId: 'usr_teach_3', firstName: 'Sarah', lastName: 'Tshilombo', email: 's.tshilombo@leshorizons-ecole.cd', phone: '+243 833 445 566', subjects: ['Sciences de la Vie et de la Terre', 'Chimie'], classes: ['6e Primaire B', '3e Secondaire A'], avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80' },
  { id: 'teach_4', userId: 'usr_teach_4', firstName: 'Patrick', lastName: 'Ilunga', email: 'p.ilunga@leshorizons-ecole.cd', phone: '+243 855 667 788', subjects: ['Histoire-Géo', 'Éducation Civique'], classes: ['1re Secondaire B', '2e Secondaire B'], avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80' },
];

export const MOCK_STUDENTS: Student[] = [
  ...DEMO_CHILDREN,
  { id: 'stud_3', userId: 'usr_stud_3', firstName: 'David', lastName: 'Muleba', matricule: 'HOR-2026-0012', classId: 'cls_1sec_a', className: '1re Secondaire A', parentId: 'usr_parent_2', dateOfBirth: '2013-02-10', gender: 'M', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80', overallAverage: 78.0 },
  { id: 'stud_4', userId: 'usr_stud_4', firstName: 'Divine', lastName: 'Kalonji', matricule: 'HOR-2026-0045', classId: 'cls_1sec_a', className: '1re Secondaire A', parentId: 'usr_parent_3', dateOfBirth: '2013-08-25', gender: 'F', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80', overallAverage: 88.0 },
  { id: 'stud_5', userId: 'usr_stud_5', firstName: 'Emmanuel', lastName: 'Kabila', matricule: 'HOR-2026-0099', classId: 'cls_2sec_a', className: '2e Secondaire A', parentId: 'usr_parent_4', dateOfBirth: '2012-04-12', gender: 'M', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80', overallAverage: 82.3 },
  { id: 'stud_6', userId: 'usr_stud_6', firstName: 'Nathalie', lastName: 'Tshimanga', matricule: 'HOR-2026-0177', classId: 'cls_3sec_a', className: '3e Secondaire A', parentId: 'usr_parent_5', dateOfBirth: '2011-09-01', gender: 'F', avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80', overallAverage: 94.0 },
];

export const MOCK_PARENTS: Parent[] = [
  { id: 'par_1', userId: 'usr_parent_1', firstName: 'Marie', lastName: 'Kabedi', phone: '+243 998 765 432', email: 'm.kabedi@gmail.com', address: 'Quartier Ma Campagne 12', children: DEMO_CHILDREN },
  { id: 'par_2', userId: 'usr_parent_2', firstName: 'Alain', lastName: 'Muleba', phone: '+243 812 345 678', email: 'alain.muleba@yahoo.fr', address: 'Avenue du 30 Juin 104', children: [] },
  { id: 'par_3', userId: 'usr_parent_3', firstName: 'Espérance', lastName: 'Kalonji', phone: '+243 854 321 098', email: 'esperance.k@gmail.com', address: 'Quartier Righini', children: [] },
];

export const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'ann_1',
    title: 'Réunion des parents d’élèves du 1er Trimestre',
    content: 'La Direction convoque l’ensemble des parents à la grande réunion d’évaluation du premier trimestre ce samedi 15 août 2026 à 09h00 dans la grande salle de fêtes de l’école.',
    authorName: 'M. Dieudonné Mukendi',
    authorRole: 'Proviseur',
    date: '10 Août 2026',
    priority: 'urgent',
    targetRole: 'all'
  },
  {
    id: 'ann_2',
    title: 'Contrôle périodique de Mathématiques — 1re Secondaire A',
    content: 'Chers élèves, le premier grand devoir surveillé d’Algèbre aura lieu ce jeudi 14 août de 08h à 10h. Pensez à apporter vos instruments de géométrie.',
    authorName: 'Mme. Clarisse Mbuyi',
    authorRole: 'Prof. Titulaire',
    date: '09 Août 2026',
    priority: 'important',
    targetClassName: '1re Secondaire A'
  },
  {
    id: 'ann_3',
    title: 'Lancement du Club Robotique & Codage PaTShi',
    content: 'Les inscriptions aux ateliers scientifiques et informatiques du samedi matin sont désormais ouvertes au bureau de la direction administrative.',
    authorName: 'Direction Pédagogique',
    authorRole: 'Administration',
    date: '05 Août 2026',
    priority: 'normal',
    targetRole: 'all'
  }
];

export const MOCK_NOTIFICATIONS: AppNotification[] = [
  { id: 'not_1', title: 'Nouvelle note disponible', message: 'Mme Clarisse Mbuyi a publié la note du devoir de Mathématiques pour Marc Kabedi (17.5/20).', date: 'Il y a 10 minutes', read: false, type: 'info' },
  { id: 'not_2', title: 'Rappel d’Échéance de Frais', message: 'Le 2ème acompte des frais de scolarité pour Marc Kabedi arrives à échéance le 25 août 2026.', date: 'Il y a 2 heures', read: false, type: 'warning' },
  { id: 'not_3', title: 'Annonce Urgente', message: 'Réunion générale des parents d’élèves ce samedi 15 août à 09h00.', date: 'Hier', read: true, type: 'urgent' },
  { id: 'not_4', title: 'Présence confirmée', message: 'Marc Kabedi a été marqué Présent à 07h45 aujourd’hui.', date: 'Hier', read: true, type: 'success' }
];

export const MOCK_ATTENDANCE: AttendanceRecord[] = [
  // Marc Kabedi (1re Sec A)
  { id: 'att_1', studentId: 'stud_1', studentName: 'Marc Kabedi', className: '1re Secondaire A', date: '2026-08-12', status: 'present' },
  { id: 'att_2', studentId: 'stud_1', studentName: 'Marc Kabedi', className: '1re Secondaire A', date: '2026-08-11', status: 'present' },
  { id: 'att_3', studentId: 'stud_1', studentName: 'Marc Kabedi', className: '1re Secondaire A', date: '2026-08-10', status: 'late', justification: 'Bouchons sur le trajet' },
  { id: 'att_4', studentId: 'stud_1', studentName: 'Marc Kabedi', className: '1re Secondaire A', date: '2026-08-07', status: 'present' },
  { id: 'att_4b', studentId: 'stud_1', studentName: 'Marc Kabedi', className: '1re Secondaire A', date: '2026-08-05', status: 'absent', justification: 'Consultation médicale (Justificatif fourni)' },
  // Grace Kabedi (6e Prim B)
  { id: 'att_5', studentId: 'stud_2', studentName: 'Grace Kabedi', className: '6e Primaire B', date: '2026-08-12', status: 'present' },
  { id: 'att_5b', studentId: 'stud_2', studentName: 'Grace Kabedi', className: '6e Primaire B', date: '2026-08-11', status: 'present' },
  { id: 'att_5c', studentId: 'stud_2', studentName: 'Grace Kabedi', className: '6e Primaire B', date: '2026-08-10', status: 'present' },
  // Other students
  { id: 'att_6', studentId: 'stud_3', studentName: 'David Muleba', className: '1re Secondaire A', date: '2026-08-12', status: 'absent', justification: 'Maladie (Billet médical fourni)' }
];

export const MOCK_HOMEWORK: Homework[] = [
  {
    id: 'hw_1',
    classId: 'cls_1sec_a',
    className: '1re Secondaire A',
    subject: 'Mathématiques',
    title: 'Résolution d’équations du premier degré',
    description: 'Faire les exercices N° 12, 14 et 15 de la page 48 du manuel de mathématiques.',
    dueDate: '2026-08-15',
    createdAt: '2026-08-10',
    teacherName: 'Mme. Clarisse Mbuyi',
    hasSubmission: false
  },
  {
    id: 'hw_2',
    classId: 'cls_1sec_a',
    className: '1re Secondaire A',
    subject: 'Français',
    title: 'Dissertation littéraire sur la poésie',
    description: 'Rédiger une synthèse de deux pages sur le poème « La Cigale et la Fourmi » de Jean de La Fontaine.',
    dueDate: '2026-08-18',
    createdAt: '2026-08-11',
    teacherName: 'M. Jean Kasongo',
    hasSubmission: true
  },
  {
    id: 'hw_3',
    classId: 'cls_6prim_b',
    className: '6e Primaire B',
    subject: 'Sciences',
    title: 'Le cycle de l’eau et l’écosystème',
    description: 'Dessiner un schéma annoté représentant le cycle naturel de l’eau.',
    dueDate: '2026-08-14',
    createdAt: '2026-08-09',
    teacherName: 'Mme. Sarah Tshilombo',
    hasSubmission: true
  }
];

export const MOCK_GRADES: GradeRecord[] = [
  // Marc Kabedi (stud_1)
  { id: 'grd_1', studentId: 'stud_1', studentName: 'Marc Kabedi', subject: 'Mathématiques', score: 17.5, maxScore: 20, period: '1er Trimestre', date: '2026-08-08', teacherComment: 'Excellent travail, raisonnement très rigoureux !', coefficient: 4 },
  { id: 'grd_2', studentId: 'stud_1', studentName: 'Marc Kabedi', subject: 'Français', score: 16.0, maxScore: 20, period: '1er Trimestre', date: '2026-08-05', teacherComment: 'Bonne expression écrite et orthographe soignée.', coefficient: 3 },
  { id: 'grd_3', studentId: 'stud_1', studentName: 'Marc Kabedi', subject: 'Physique-Chimie', score: 18.0, maxScore: 20, period: '1er Trimestre', date: '2026-08-03', teacherComment: 'Remarquable maîtrise des concepts pratiques.', coefficient: 3 },
  { id: 'grd_4', studentId: 'stud_1', studentName: 'Marc Kabedi', subject: 'Histoire-Géo', score: 15.0, maxScore: 20, period: '1er Trimestre', date: '2026-07-28', teacherComment: 'Bonne assimilation du cours.', coefficient: 2 },
  // Grace Kabedi (stud_2)
  { id: 'grd_5', studentId: 'stud_2', studentName: 'Grace Kabedi', subject: 'Calcul Mental', score: 19.0, maxScore: 20, period: '1er Trimestre', date: '2026-08-09', teacherComment: 'Très rapide et précise ! Bravo.', coefficient: 4 },
  { id: 'grd_6', studentId: 'stud_2', studentName: 'Grace Kabedi', subject: 'Lecture & Dictée', score: 18.5, maxScore: 20, period: '1er Trimestre', date: '2026-08-04', teacherComment: 'Excellente lecture expressive.', coefficient: 3 },
  { id: 'grd_7', studentId: 'stud_2', studentName: 'Grace Kabedi', subject: 'Sciences', score: 17.0, maxScore: 20, period: '1er Trimestre', date: '2026-08-01', teacherComment: 'Schémas très précis et bien annotés.', coefficient: 3 }
];

export const MOCK_TIMETABLE: TimetableSlot[] = [
  // 1re Secondaire A (Marc Kabedi)
  { id: 'tt_1', className: '1re Secondaire A', dayOfWeek: 'Lundi', startTime: '07:30', endTime: '08:20', subject: 'Mathématiques', teacherName: 'Mme. Clarisse Mbuyi', room: 'Local S-101' },
  { id: 'tt_2', className: '1re Secondaire A', dayOfWeek: 'Lundi', startTime: '08:25', endTime: '09:15', subject: 'Français', teacherName: 'M. Jean Kasongo', room: 'Local S-101' },
  { id: 'tt_3', className: '1re Secondaire A', dayOfWeek: 'Lundi', startTime: '09:35', endTime: '10:25', subject: 'Physique-Chimie', teacherName: 'Mme. Clarisse Mbuyi', room: 'Labo Sciences' },
  { id: 'tt_4', className: '1re Secondaire A', dayOfWeek: 'Lundi', startTime: '10:30', endTime: '11:20', subject: 'Histoire-Géo', teacherName: 'M. Patrick Ilunga', room: 'Local S-101' },
  { id: 'tt_5', className: '1re Secondaire A', dayOfWeek: 'Mardi', startTime: '07:30', endTime: '08:20', subject: 'Anglais', teacherName: 'M. Eric Banza', room: 'Local S-101' },
  { id: 'tt_6', className: '1re Secondaire A', dayOfWeek: 'Mardi', startTime: '08:25', endTime: '09:15', subject: 'Mathématiques', teacherName: 'Mme. Clarisse Mbuyi', room: 'Local S-101' },
  { id: 'tt_7', className: '1re Secondaire A', dayOfWeek: 'Mercredi', startTime: '07:30', endTime: '08:20', subject: 'Informatique PaTShi', teacherName: 'M. Dieudonné Mukendi', room: 'Salle Informatique' },
  // 6e Primaire B (Grace Kabedi)
  { id: 'tt_8', className: '6e Primaire B', dayOfWeek: 'Lundi', startTime: '07:30', endTime: '08:20', subject: 'Calcul Mental', teacherName: 'Mme. Sarah Tshilombo', room: 'Local P-07' },
  { id: 'tt_9', className: '6e Primaire B', dayOfWeek: 'Lundi', startTime: '08:25', endTime: '09:15', subject: 'Lecture & Dictée', teacherName: 'M. Jean Kasongo', room: 'Local P-07' },
  { id: 'tt_10', className: '6e Primaire B', dayOfWeek: 'Lundi', startTime: '09:35', endTime: '10:25', subject: 'Sciences', teacherName: 'Mme. Sarah Tshilombo', room: 'Local P-07' },
  { id: 'tt_11', className: '6e Primaire B', dayOfWeek: 'Mardi', startTime: '07:30', endTime: '08:20', subject: 'Éducation Civique', teacherName: 'Mme. Sarah Tshilombo', room: 'Local P-07' }
];

export const MOCK_EVENTS: SchoolEvent[] = [
  { id: 'evt_1', title: 'Réunion Trimestrielle des Parents', description: 'Rencontre annuelle d’échange pédagogique et présentation des bulletins provisoires.', date: '15 Août 2026', time: '09:00 - 12:30', location: 'Grande Salle des Fêtes', category: 'meeting' },
  { id: 'evt_2', title: 'Tournoi Inter-Scolaire de Football & Basket', description: 'Compétition sportive annuelle contre le Collège Saint-Joseph.', date: '22 Août 2026', time: '13:00 - 17:00', location: 'Complexe Sportif Les Horizons', category: 'sports' },
  { id: 'evt_3', title: 'Session d’Examens du 1er Trimestre', description: 'Début des épreuves officielles pour les classes du secondaire.', date: '01 Septembre 2026', time: '08:00 - 14:00', location: 'Toutes les salles', category: 'academic' },
  { id: 'evt_4', title: 'Vacances de Toussaint & Congé Pédagogique', description: 'Interruption des cours pour la première pause du calendrier scolaire.', date: '28 Octobre 2026', time: 'Toute la journée', location: 'Établissement', category: 'holiday' }
];

export const MOCK_PAYMENTS: PaymentRecord[] = [
  { id: 'pay_1', studentId: 'stud_1', studentName: 'Marc Kabedi', className: '1re Secondaire A', parentId: 'usr_parent_1', amount: 350, currency: '$', description: 'Frais de Scolarité - 1er Trimestre', dueDate: '2026-09-01', paidDate: '2026-08-01', status: 'paid', receiptNumber: 'REC-2026-0891' },
  { id: 'pay_2', studentId: 'stud_1', studentName: 'Marc Kabedi', className: '1re Secondaire A', parentId: 'usr_parent_1', amount: 150, currency: '$', description: 'Frais d’Informatique & Labo', dueDate: '2026-08-25', status: 'pending' },
  { id: 'pay_3', studentId: 'stud_2', studentName: 'Grace Kabedi', className: '6e Primaire B', parentId: 'usr_parent_1', amount: 280, currency: '$', description: 'Frais de Scolarité - 1er Trimestre', dueDate: '2026-09-01', paidDate: '2026-07-28', status: 'paid', receiptNumber: 'REC-2026-0742' },
  { id: 'pay_4', studentId: 'stud_3', studentName: 'David Muleba', className: '1re Secondaire A', parentId: 'usr_parent_2', amount: 350, currency: '$', description: 'Frais de Scolarité - 1er Trimestre', dueDate: '2026-08-05', status: 'overdue' }
];

export const MOCK_DOCUMENTS: SchoolDocument[] = [
  { id: 'doc_1', title: 'Règlement Intérieur 2026–2027', category: 'reglement', date: '01 Août 2026', size: '1.4 MB', targetRole: 'Tous' },
  { id: 'doc_2', title: 'Calendrier Scolaire Officiel 2026-2027', category: 'administratif', date: '02 Août 2026', size: '850 KB', targetRole: 'Tous' },
  { id: 'doc_3', title: 'Guide de connexion Élèves & Parents PaTShi', category: 'administratif', date: '05 Août 2026', size: '2.1 MB', targetRole: 'Parents' },
  { id: 'doc_4', title: 'Programme du cours de Mathématiques 1re Sec', category: 'cours', date: '08 Août 2026', size: '620 KB', targetRole: 'Élèves' },
  { id: 'doc_5', title: 'Bulletin Provisoire 1er Trimestre — Marc Kabedi', category: 'bulletin', date: '10 Août 2026', size: '420 KB', targetRole: 'Parents' },
  { id: 'doc_6', title: 'Attestation d’inscription 2026-2027', category: 'administratif', date: '01 Août 2026', size: '310 KB', targetRole: 'Parents' }
];

export const MOCK_COURSES = [
  { id: 'crs_1', name: 'Mathématiques', code: 'MATH-101', teacherName: 'Mme. Clarisse Mbuyi', progress: 78, nextClass: 'Lundi 07:30 (Local S-101)', documentCount: 6 },
  { id: 'crs_2', name: 'Français & Littérature', code: 'FRA-101', teacherName: 'M. Jean Kasongo', progress: 85, nextClass: 'Lundi 08:25 (Local S-101)', documentCount: 4 },
  { id: 'crs_3', name: 'Physique-Chimie', code: 'PHY-101', teacherName: 'Mme. Clarisse Mbuyi', progress: 70, nextClass: 'Lundi 09:35 (Labo Sciences)', documentCount: 5 },
  { id: 'crs_4', name: 'Histoire-Géographie', code: 'HIS-101', teacherName: 'M. Patrick Ilunga', progress: 80, nextClass: 'Lundi 10:30 (Local S-101)', documentCount: 3 }
];

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv_1',
    participantId: 'usr_teach_1',
    participantName: 'Mme. Clarisse Mbuyi',
    participantRole: 'teacher',
    participantAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    lastMessage: 'Bonjour Mme Kabedi, Marc fait d’excellents progrès en géométrie.',
    lastMessageTime: '10:45',
    unreadCount: 1
  },
  {
    id: 'conv_2',
    participantId: 'usr_admin_1',
    participantName: 'M. Dieudonné Mukendi',
    participantRole: 'admin',
    participantAvatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80',
    lastMessage: 'Veuillez trouver ci-joint l’invitation pour la réunion administrative.',
    lastMessageTime: 'Hier',
    unreadCount: 0
  }
];

export const MOCK_MESSAGES: Record<string, Message[]> = {
  conv_1: [
    { id: 'msg_1', conversationId: 'conv_1', senderId: 'usr_parent_1', senderName: 'Mme. Marie Kabedi', senderRole: 'parent', content: 'Bonjour Mme Mbuyi, j’aimerais savoir si le devoir de mathématiques de Marc doit être rendu sous forme manuscrite.', timestamp: '10:15', read: true },
    { id: 'msg_2', conversationId: 'conv_1', senderId: 'usr_teach_1', senderName: 'Mme. Clarisse Mbuyi', senderRole: 'teacher', content: 'Bonjour Mme Kabedi, Marc fait d’excellents progrès en géométrie. Oui, sous forme manuscrite sur une feuille de devoir classique.', timestamp: '10:45', read: false }
  ],
  conv_2: [
    { id: 'msg_3', conversationId: 'conv_2', senderId: 'usr_admin_1', senderName: 'M. Dieudonné Mukendi', senderRole: 'admin', content: 'Veuillez trouver ci-joint l’invitation pour la réunion administrative.', timestamp: 'Hier', read: true }
  ]
};

export const MOCK_SETTINGS = {
  schoolName: 'Complexe Scolaire Les Horizons',
  academicYear: '2026–2027',
  primaryColor: '#0F172A',
  accentColor: '#F59E0B',
  phone: '+243 819 883 084',
  whatsapp: '+420 776 308 018',
  email: 'contact@leshorizons-ecole.cd',
  terms: ['1er Trimestre', '2ème Trimestre', '3ème Trimestre'],
  feeTypes: ['Frais de Scolarité', 'Frais d’Informatique & Labo', 'Frais de Cantine', 'Frais d’Examens']
};
