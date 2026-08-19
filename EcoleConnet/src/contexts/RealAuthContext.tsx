import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { RealProfile, RealSchool } from '../types/auth';

interface RealAuthContextType {
  isConfigured: boolean;
  session: Session | null;
  user: User | null;
  profile: RealProfile | null;
  school: RealSchool | null;
  loading: boolean;
  authError: string | null;
  signInWithEmail: (email: string, pass: string) => Promise<{ error: Error | null }>;
  signOutReal: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const RealAuthContext = createContext<RealAuthContextType | undefined>(undefined);

export const RealAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<RealProfile | null>(null);
  const [school, setSchool] = useState<RealSchool | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const fetchProfileAndSchool = async (userId: string) => {
    try {
      setAuthError(null);
      // Fetch Profile
      let { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // Auto-récupération d'un compte invité venant de définir son mot de passe
      if (profileErr || !profileData || !profileData.is_active) {
        try {
          if (profileData?.role === 'teacher') {
            const { data: actData, error: actErr } = await supabase.rpc('activate_teacher_on_password_set');
            if (!actErr && actData === true) {
              await supabase.auth.refreshSession();
              const { data: retryData } = await supabase.from('profiles').select('*').eq('id', userId).single();
              if (retryData?.is_active) { profileData = retryData; profileErr = null; }
            }
          } else if (profileData?.role === 'parent') {
            const { data: actData, error: actErr } = await supabase.rpc('activate_parent_on_password_set');
            if (!actErr && actData === true) {
              await supabase.auth.refreshSession();
              const { data: retryData } = await supabase.from('profiles').select('*').eq('id', userId).single();
              if (retryData?.is_active) { profileData = retryData; profileErr = null; }
            }
          } else if (profileData?.role === 'student') {
            const { data: actData, error: actErr } = await supabase.rpc('activate_student_on_password_set');
            if (!actErr && actData === true) {
              await supabase.auth.refreshSession();
              const { data: retryData } = await supabase.from('profiles').select('*').eq('id', userId).single();
              if (retryData?.is_active) { profileData = retryData; profileErr = null; }
            }
          }
        } catch (recErr) {
          // Ignorer l'échec de la tentative
        }
      }

      if (profileErr || !profileData) {
        setProfile(null);
        setSchool(null);
        setAuthError("Profil utilisateur introuvable. Veuillez contacter l'administration de votre école.");
        return;
      }

      if (!profileData.is_active) {
        setProfile(profileData as RealProfile);
        setSchool(null);
        setAuthError("Votre compte est actuellement désactivé. Veuillez contacter PaTShi-Digital.");
        return;
      }

      setProfile(profileData as RealProfile);

      // Fetch School if attached
      if (profileData.school_id) {
        const { data: schoolData, error: schoolErr } = await supabase
          .from('schools')
          .select('*')
          .eq('id', profileData.school_id)
          .single();

        if (!schoolErr && schoolData) {
          setSchool(schoolData as RealSchool);
          if (schoolData.status === 'suspended' || schoolData.status === 'archived') {
            setAuthError(
              schoolData.status === 'archived'
                ? "Cet établissement a été archivé. L'accès aux comptes associés est désactivé."
                : "L’accès pour votre établissement est temporairement suspendu."
            );
          }
        }
      } else {
        setSchool(null);
      }
    } catch (err: any) {
      console.error('Error fetching profile:', err);
      setAuthError('Erreur de connexion au serveur d’authentification.');
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: initSession } }) => {
      setSession(initSession);
      setUser(initSession?.user ?? null);
      if (initSession?.user) {
        fetchProfileAndSchool(initSession.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listen to Auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        setLoading(true);
        await fetchProfileAndSchool(newSession.user.id);
        setLoading(false);
      } else {
        setProfile(null);
        setSchool(null);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string, pass: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error("Supabase n'est pas encore configuré dans .env.local.") };
    }
    setLoading(true);
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) {
      setLoading(false);
      return { error };
    }
    if (data.user) {
      await fetchProfileAndSchool(data.user.id);
    }
    setLoading(false);
    return { error: null };
  };

  const signOutReal = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setUser(null);
    setProfile(null);
    setSchool(null);
    setAuthError(null);
  };

  const sendPasswordReset = async (email: string) => {
    if (!isSupabaseConfigured) {
      return { error: new Error("Supabase n'est pas configuré.") };
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reinitialiser-mot-de-passe`
    });
    return { error };
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfileAndSchool(user.id);
    }
  };

  return (
    <RealAuthContext.Provider
      value={{
        isConfigured: isSupabaseConfigured,
        session,
        user,
        profile,
        school,
        loading,
        authError,
        signInWithEmail,
        signOutReal,
        sendPasswordReset,
        refreshProfile
      }}
    >
      {children}
    </RealAuthContext.Provider>
  );
};

export const useRealAuth = () => {
  const context = useContext(RealAuthContext);
  if (!context) {
    throw new Error('useRealAuth doit être utilisé à l’intérieur de RealAuthProvider');
  }
  return context;
};
