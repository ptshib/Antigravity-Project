import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { AppNotification } from '../types';
import { MOCK_NOTIFICATIONS } from '../data/mockData';

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'urgent';
}

interface NotificationContextType {
  notifications: AppNotification[];
  toasts: ToastItem[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  addNotification: (title: string, message: string, type?: AppNotification['type']) => void;
  showToast: (message: string, type?: ToastItem['type']) => void;
  removeToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>(MOCK_NOTIFICATIONS);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const removeToast = React.useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const markAsRead = React.useCallback((id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllAsRead = React.useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const showToast = React.useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = `toast_${Date.now()}_${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }, [removeToast]);

  const addNotification = React.useCallback((title: string, message: string, type: AppNotification['type'] = 'info') => {
    const newNotif: AppNotification = {
      id: `notif_${Date.now()}`,
      title,
      message,
      date: 'À l’instant',
      read: false,
      type
    };
    setNotifications(prev => [newNotif, ...prev]);
    showToast(title, type);
  }, [showToast]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        toasts,
        unreadCount,
        markAsRead,
        markAllAsRead,
        addNotification,
        showToast,
        removeToast
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
