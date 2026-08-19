import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { User, UserRole } from '../types';
import { DEMO_USERS } from '../data/mockData';

interface AuthContextType {
  user: User | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  loginAs: (targetRole: UserRole) => void;
  logout: () => void;
  switchRole: (targetRole: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(DEMO_USERS.parent);
  const [role, setRole] = useState<UserRole | null>('parent');

  const loginAs = (targetRole: UserRole) => {
    const demoUser = DEMO_USERS[targetRole];
    if (demoUser) {
      setUser(demoUser);
      setRole(targetRole);
    }
  };

  const logout = () => {
    setUser(null);
    setRole(null);
  };

  const switchRole = (targetRole: UserRole) => {
    loginAs(targetRole);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isAuthenticated: !!user,
        loginAs,
        logout,
        switchRole
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
