export type UserRole = 'admin' | 'teacher' | 'parent' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  phone?: string;
  schoolName: string;
  academicYear: string;
}

export interface Student {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  matricule: string;
  classId: string;
  className: string;
  parentId: string;
  dateOfBirth: string;
  gender: 'M' | 'F';
  avatar: string;
  overallAverage?: number;
}

export interface Parent {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  children: Student[];
}

export interface Teacher {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  subjects: string[];
  classes: string[];
  avatar: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  level: string;
  mainTeacherId: string;
  mainTeacherName: string;
  studentCount: number;
  room: string;
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  iconName?: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  authorName: string;
  authorRole: string;
  date: string;
  priority: 'normal' | 'important' | 'urgent';
  targetRole?: UserRole | 'all';
  targetClassName?: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type: 'info' | 'success' | 'warning' | 'urgent';
  linkTab?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  content: string;
  timestamp: string;
  read: boolean;
  attachmentName?: string;
}

export interface Conversation {
  id: string;
  participantId: string;
  participantName: string;
  participantRole: UserRole;
  participantAvatar: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  date: string;
  status: 'present' | 'absent' | 'late';
  justification?: string;
}

export interface Homework {
  id: string;
  classId: string;
  className: string;
  subject: string;
  title: string;
  description: string;
  dueDate: string;
  createdAt: string;
  teacherName: string;
  hasSubmission?: boolean;
}

export interface GradeRecord {
  id: string;
  studentId: string;
  studentName: string;
  subject: string;
  score: number;
  maxScore: number;
  period: string;
  date: string;
  teacherComment: string;
  coefficient: number;
}

export interface TimetableSlot {
  id: string;
  className: string;
  dayOfWeek: 'Lundi' | 'Mardi' | 'Mercredi' | 'Jeudi' | 'Vendredi';
  startTime: string;
  endTime: string;
  subject: string;
  teacherName: string;
  room: string;
}

export interface SchoolEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  category: 'academic' | 'sports' | 'meeting' | 'holiday';
}

export interface PaymentRecord {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  parentId: string;
  amount: number;
  currency: string;
  description: string;
  dueDate: string;
  paidDate?: string;
  status: 'paid' | 'pending' | 'overdue';
  receiptNumber?: string;
}

export interface SchoolDocument {
  id: string;
  title: string;
  category: 'bulletin' | 'reglement' | 'cours' | 'administratif';
  date: string;
  size: string;
  targetRole?: string;
  downloadUrl?: string;
}
