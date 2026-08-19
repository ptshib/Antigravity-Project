import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type {
  Announcement,
  AttendanceRecord,
  Homework,
  GradeRecord,
  Conversation,
  Message,
  Student
} from '../types';
import {
  MOCK_ANNOUNCEMENTS,
  MOCK_ATTENDANCE,
  MOCK_HOMEWORK,
  MOCK_GRADES,
  MOCK_CONVERSATIONS,
  MOCK_MESSAGES,
  DEMO_CHILDREN
} from '../data/mockData';

interface DemoContextType {
  announcements: Announcement[];
  attendance: AttendanceRecord[];
  homework: Homework[];
  grades: GradeRecord[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeChildIndex: number;
  activeChild: Student;
  setActiveChildIndex: (index: number) => void;
  addAnnouncement: (announcement: Omit<Announcement, 'id' | 'date'>) => void;
  markAttendance: (studentId: string, studentName: string, className: string, status: 'present' | 'absent' | 'late', justification?: string, customDate?: string) => void;
  createHomework: (homework: Omit<Homework, 'id' | 'createdAt'>) => void;
  addGrade: (grade: Omit<GradeRecord, 'id' | 'date'>) => void;
  sendMessage: (conversationId: string, content: string, senderId: string, senderName: string, senderRole: any) => void;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export const DemoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>(MOCK_ANNOUNCEMENTS);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(MOCK_ATTENDANCE);
  const [homework, setHomework] = useState<Homework[]>(MOCK_HOMEWORK);
  const [grades, setGrades] = useState<GradeRecord[]>(MOCK_GRADES);
  const [conversations, setConversations] = useState<Conversation[]>(MOCK_CONVERSATIONS);
  const [messages, setMessages] = useState<Record<string, Message[]>>(MOCK_MESSAGES);
  const [activeChildIndex, setActiveChildIndex] = useState<number>(0);

  const activeChild = DEMO_CHILDREN[activeChildIndex] || DEMO_CHILDREN[0];

  const addAnnouncement = (announcementData: Omit<Announcement, 'id' | 'date'>) => {
    const newAnn: Announcement = {
      ...announcementData,
      id: `ann_${Date.now()}`,
      date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    };
    setAnnouncements(prev => [newAnn, ...prev]);
  };

  const markAttendance = (
    studentId: string,
    studentName: string,
    className: string,
    status: 'present' | 'absent' | 'late',
    justification?: string,
    customDate?: string
  ) => {
    const recordDate = customDate || new Date().toISOString().split('T')[0];
    const newRecord: AttendanceRecord = {
      id: `att_${Date.now()}_${studentId}`,
      studentId,
      studentName,
      className,
      date: recordDate,
      status,
      justification
    };
    setAttendance(prev => [newRecord, ...prev.filter(a => !(a.studentId === studentId && a.date === recordDate))]);
  };

  const createHomework = (hwData: Omit<Homework, 'id' | 'createdAt'>) => {
    const newHw: Homework = {
      ...hwData,
      id: `hw_${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };
    setHomework(prev => [newHw, ...prev]);
  };

  const addGrade = (gradeData: Omit<GradeRecord, 'id' | 'date'>) => {
    const newGrade: GradeRecord = {
      ...gradeData,
      id: `grd_${Date.now()}`,
      date: new Date().toISOString().split('T')[0]
    };
    setGrades(prev => [newGrade, ...prev]);
  };

  const sendMessage = (conversationId: string, content: string, senderId: string, senderName: string, senderRole: any) => {
    const newMsg: Message = {
      id: `msg_${Date.now()}`,
      conversationId,
      senderId,
      senderName,
      senderRole,
      content,
      timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      read: true
    };

    setMessages(prev => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), newMsg]
    }));

    setConversations(prev =>
      prev.map(c =>
        c.id === conversationId
          ? { ...c, lastMessage: content, lastMessageTime: newMsg.timestamp, unreadCount: 0 }
          : c
      )
    );
  };

  return (
    <DemoContext.Provider
      value={{
        announcements,
        attendance,
        homework,
        grades,
        conversations,
        messages,
        activeChildIndex,
        activeChild,
        setActiveChildIndex,
        addAnnouncement,
        markAttendance,
        createHomework,
        addGrade,
        sendMessage
      }}
    >
      {children}
    </DemoContext.Provider>
  );
};

export const useDemo = () => {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error('useDemo variable single context must be used within DemoProvider');
  }
  return context;
};
