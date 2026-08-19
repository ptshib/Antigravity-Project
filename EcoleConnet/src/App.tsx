import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { DemoProvider } from './context/DemoContext';
import { RealAuthProvider, useRealAuth } from './contexts/RealAuthContext';
import { ToastContainer } from './components/common/ToastContainer';
import { DemoBanner } from './components/common/DemoBanner';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { LandingPage } from './pages/LandingPage';
import { DemoSelectorPage } from './pages/DemoSelectorPage';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { TeacherDashboard } from './pages/teacher/TeacherDashboard';
import { ParentDashboard } from './pages/parent/ParentDashboard';
import { StudentDashboard } from './pages/student/StudentDashboard';
import { AttendanceModal } from './components/modals/AttendanceModal';
import { HomeworkModal } from './components/modals/HomeworkModal';
import { GradeModal } from './components/modals/GradeModal';
import { AnnouncementModal } from './components/modals/AnnouncementModal';
import { MessagingModule } from './components/messaging/MessagingModule';
import { Modal } from './components/common/Modal';

// Real Auth Pages
import { LoginPage } from './pages/auth/LoginPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SetPasswordPage } from './pages/auth/SetPasswordPage';
import { AccountSuspendedPage } from './pages/auth/AccountSuspendedPage';
import { ConfigRequiredPage } from './pages/auth/ConfigRequiredPage';
import { SuperAdminDashboard } from './pages/superadmin/SuperAdminDashboard';
import { SchoolSupervisionPage } from './pages/superadmin/SchoolSupervisionPage';
import { RealSchoolAdminPortal } from './pages/admin/RealSchoolAdminPortal';
import { RealTeacherPortal } from './pages/teacher/RealTeacherPortal';
import { RealParentPortal } from './pages/parent/RealParentPortal';
import { RealStudentPortal } from './pages/student/RealStudentPortal';

export type AppView = 
  | 'landing' 
  | 'demo_selector' 
  | 'demo_portal' 
  | 'connexion' 
  | 'mot_de_passe_oublie' 
  | 'reinitialiser_mot_de_passe' 
  | 'auth_set_password'
  | 'acces_suspendu' 
  | 'configuration_requise' 
  | 'app_superadmin_school'
  | 'app_portal';

function parsePathToView(pathname: string): AppView {
  const cleanPath = pathname.split('?')[0].replace(/\/$/, '') || '/';

  if (cleanPath === '' || cleanPath === '/') return 'landing';
  if (cleanPath === '/connexion') return 'connexion';
  if (cleanPath === '/mot-de-passe-oublie') return 'mot_de_passe_oublie';
  if (cleanPath === '/reinitialiser-mot-de-passe') return 'reinitialiser_mot_de_passe';
  if (cleanPath === '/auth/set-password' || cleanPath === '/auth/definir-mot-de-passe' || cleanPath === '/definir-mot-de-passe') return 'auth_set_password';
  if (cleanPath === '/acces-suspendu') return 'acces_suspendu';
  if (cleanPath === '/configuration-requise') return 'configuration_requise';
  if (cleanPath === '/demo' || cleanPath.startsWith('/demo/')) return 'demo_selector';

  // 1. SPECIFIC DYNAMIC SUB-ROUTES TESTED FIRST BEFORE GENERAL /app
  if (cleanPath.startsWith('/app/superadmin/ecoles/')) return 'app_superadmin_school';
  if (cleanPath.startsWith('/app')) return 'app_portal';

  return 'landing';
}

const MainLayout: React.FC = () => {
  const { role } = useAuth();
  const realAuth = useRealAuth();
  
  // State synchronized with URL
  const [currentView, setCurrentView] = useState<AppView>(() => parsePathToView(window.location.pathname));
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Modals state
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showHomeworkModal, setShowHomeworkModal] = useState(false);
  const [showGradeModal, setShowGradeModal] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showMessagingModal, setShowMessagingModal] = useState(false);

  // Client-side Navigation helper
  const navigate = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentView(parsePathToView(path));
  }, []);

  // Listen to browser Back/Forward popstate events
  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(parsePathToView(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Automatic Protected Route Redirects for Real Auth
  useEffect(() => {
    if (realAuth.loading) return;

    const pathname = window.location.pathname;

    // 1. If trying to access protected /app routes without a session
    if (pathname.startsWith('/app') && !realAuth.user) {
      navigate('/connexion');
      return;
    }

    // 2. If signed in, handle post-login redirects ONLY when on /connexion or /
    if (realAuth.user && realAuth.session) {
      if (realAuth.profile && (!realAuth.profile.is_active || realAuth.school?.status === 'suspended' || realAuth.school?.status === 'archived')) {
        if (pathname !== '/acces-suspendu') {
          navigate('/acces-suspendu');
        }
      } else if (realAuth.profile) {
        const rolePathMap: Record<string, string> = {
          super_admin: '/app/superadmin',
          school_admin: '/app/ecole',
          teacher: '/app/enseignant',
          parent: '/app/parent',
          student: '/app/eleve'
        };
        const targetRolePath = rolePathMap[realAuth.profile.role] || `/app/${realAuth.profile.role}`;
        if (pathname === '/connexion' || pathname === '/') {
          navigate(targetRolePath);
        }
      }
    }
  }, [realAuth.user, realAuth.session, realAuth.profile, realAuth.school, realAuth.loading, realAuth.authError, navigate]);

  // Handler for demo role selection
  const handleSelectRoleFromDemo = () => {
    setCurrentView('demo_portal');
    setActiveTab('dashboard');
    if (window.location.pathname !== '/demo/portal') {
      window.history.pushState({}, '', '/demo/portal');
    }
  };

  // Render Full Screen Loading Spinner during Real Auth initialization
  if (realAuth.loading && window.location.pathname.startsWith('/app')) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white space-y-4">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-slate-300">Vérification de la session sécurisée ÉcoleConnect...</p>
      </div>
    );
  }

  // 1. LANDING PAGE ROUTE (/)
  if (currentView === 'landing') {
    return (
      <LandingPage
        onGoToDemo={() => navigate('/demo')}
        onGoToLogin={() => navigate('/connexion')}
      />
    );
  }

  // 2. DEMO SELECTOR ROUTE (/demo)
  if (currentView === 'demo_selector') {
    return (
      <DemoSelectorPage
        onSelectRole={handleSelectRoleFromDemo}
        onGoToLanding={() => navigate('/')}
      />
    );
  }

  // 3. AUTH ROUTES
  if (currentView === 'connexion') {
    if (!realAuth.isConfigured) {
      return (
        <ConfigRequiredPage
          onGoToDemo={() => navigate('/demo')}
          onGoToLanding={() => navigate('/')}
        />
      );
    }
    return (
      <LoginPage
        onGoToDemo={() => navigate('/demo')}
        onGoToLanding={() => navigate('/')}
        onGoToForgotPassword={() => navigate('/mot-de-passe-oublie')}
      />
    );
  }

  if (currentView === 'mot_de_passe_oublie') {
    return <ForgotPasswordPage onGoToLogin={() => navigate('/connexion')} />;
  }

  if (currentView === 'reinitialiser_mot_de_passe') {
    return <ResetPasswordPage onGoToLogin={() => navigate('/connexion')} />;
  }

  if (currentView === 'auth_set_password') {
    return <SetPasswordPage onSuccessNavigate={(path) => navigate(path)} />;
  }

  if (currentView === 'acces_suspendu') {
    return (
      <AccountSuspendedPage
        reason={realAuth.authError || undefined}
        onGoToLogin={() => {
          realAuth.signOutReal();
          navigate('/connexion');
        }}
      />
    );
  }

  if (currentView === 'configuration_requise') {
    return (
      <ConfigRequiredPage
        onGoToDemo={() => navigate('/demo')}
        onGoToLanding={() => navigate('/')}
      />
    );
  }

  // 4. REAL PROTECTED PORTAL ROUTE (/app/superadmin, /app/superadmin/ecoles/:schoolId, etc.)
  if (currentView === 'app_portal' || currentView === 'app_superadmin_school') {
    if (realAuth.loading) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-bold text-slate-300">Vérification de la session sécurisée ÉcoleConnect...</p>
        </div>
      );
    }

    if (!realAuth.user) {
      return (
        <LoginPage
          onGoToDemo={() => navigate('/demo')}
          onGoToLanding={() => navigate('/')}
          onGoToForgotPassword={() => navigate('/mot-de-passe-oublie')}
        />
      );
    }

    if (realAuth.profile?.role === 'super_admin') {
      const pathname = window.location.pathname;
      if (pathname.startsWith('/app/superadmin/ecoles/')) {
        const targetSchoolId = pathname.replace('/app/superadmin/ecoles/', '').split('/')[0];
        return (
          <SchoolSupervisionPage
            schoolId={targetSchoolId}
            onBack={() => navigate('/app/superadmin')}
          />
        );
      }
      return (
        <SuperAdminDashboard
          onSelectSchool={(sId) => navigate(`/app/superadmin/ecoles/${sId}`)}
        />
      );
    }

    if (realAuth.profile?.role === 'school_admin') {
      return <RealSchoolAdminPortal />;
    }

    if (realAuth.profile?.role === 'teacher') {
      return <RealTeacherPortal />;
    }

    if (!realAuth.profile) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-bold text-slate-300">Chargement du profil utilisateur...</p>
        </div>
      );
    }

    if (!realAuth.profile.is_active || realAuth.school?.status === 'suspended' || realAuth.school?.status === 'archived') {
      return (
        <AccountSuspendedPage
          reason={realAuth.authError || undefined}
          onGoToLogin={() => {
            realAuth.signOutReal();
            navigate('/connexion');
          }}
        />
      );
    }

    if (realAuth.profile.role === 'parent') {
      return <RealParentPortal />;
    }

    if (realAuth.profile.role === 'student') {
      return <RealStudentPortal />;
    }

    // Default fallback fail-closed
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl max-w-md space-y-2">
          <h3 className="font-extrabold text-amber-400 text-base">Accès non autorisé</h3>
          <p className="text-xs text-slate-300">
            Ce profil ne dispose pas d'un rôle autorisé sur cette plateforme.
          </p>
        </div>
        <button
          onClick={() => {
            realAuth.signOutReal();
            navigate('/connexion');
          }}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl cursor-pointer"
        >
          Se déconnecter
        </button>
      </div>
    );
  }

  // 5. DEMO PORTAL VIEW (Default interactive demo dashboard backed by DemoContext)
  const renderDashboardContent = () => {
    if (activeTab === 'messages') {
      return <MessagingModule />;
    }

    switch (role) {
      case 'admin':
        return (
          <AdminDashboard
            activeTab={activeTab}
            onOpenAnnouncementModal={() => setShowAnnouncementModal(true)}
          />
        );
      case 'teacher':
        return (
          <TeacherDashboard
            activeTab={activeTab}
            onOpenAttendanceModal={() => setShowAttendanceModal(true)}
            onOpenHomeworkModal={() => setShowHomeworkModal(true)}
            onOpenGradeModal={() => setShowGradeModal(true)}
            onOpenAnnouncementModal={() => setShowAnnouncementModal(true)}
            onOpenMessaging={() => setShowMessagingModal(true)}
          />
        );
      case 'parent':
        return (
          <ParentDashboard
            activeTab={activeTab}
            onOpenMessaging={() => setShowMessagingModal(true)}
          />
        );
      case 'student':
        return <StudentDashboard activeTab={activeTab} />;
      default:
        return (
          <ParentDashboard
            activeTab={activeTab}
            onOpenMessaging={() => setShowMessagingModal(true)}
          />
        );
    }
  };

  const getPageTitle = () => {
    const titleMap: Record<string, string> = {
      dashboard: 'Tableau de bord',
      eleves: 'Élèves',
      parents: 'Parents',
      enseignants: 'Enseignants',
      classes: 'Classes',
      mes_classes: 'Mes classes',
      mes_enfants: 'Mes enfants',
      mes_cours: 'Mes cours',
      communications: 'Communications',
      presences: 'Présences',
      devoirs: 'Devoirs',
      resultats: 'Résultats & Bulletins',
      emplois_du_temps: 'Emplois du temps',
      emploi_du_temps: 'Emploi du temps',
      frais_scolaires: 'Frais scolaires',
      paiements: 'Paiements',
      messages: 'Messagerie interne',
      calendrier: 'Calendrier scolaire',
      documents: 'Documents administratifs',
      parametres: 'Paramètres'
    };
    return titleMap[activeTab] || 'Espace Établissement';
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between selection:bg-amber-100 selection:text-amber-900 max-w-full overflow-x-hidden">
      {/* Top Demo Banner */}
      <DemoBanner onOpenSelector={() => navigate('/demo')} />

      <div className="flex-1 flex overflow-hidden max-w-full">
        {/* Responsive Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onGoToLanding={() => navigate('/')}
          onOpenSelector={() => navigate('/demo')}
          isOpenMobile={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto max-w-full">
          <Header
            title={getPageTitle()}
            subtitle="Complexe Scolaire Les Horizons — Année Scolaire 2026–2027"
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onOpenMessaging={() => setShowMessagingModal(true)}
            onOpenSelector={() => navigate('/demo')}
          />

          <main className="flex-1 px-3 sm:px-6 lg:px-8 py-4 sm:py-8 max-w-7xl w-full mx-auto max-w-full">
            {renderDashboardContent()}
          </main>
        </div>
      </div>

      {/* Action Modals */}
      <AttendanceModal
        isOpen={showAttendanceModal}
        onClose={() => setShowAttendanceModal(false)}
      />
      <HomeworkModal
        isOpen={showHomeworkModal}
        onClose={() => setShowHomeworkModal(false)}
      />
      <GradeModal
        isOpen={showGradeModal}
        onClose={() => setShowGradeModal(false)}
      />
      <AnnouncementModal
        isOpen={showAnnouncementModal}
        onClose={() => setShowAnnouncementModal(false)}
      />

      {/* Messaging Modal */}
      <Modal
        isOpen={showMessagingModal}
        onClose={() => setShowMessagingModal(false)}
        title="Messagerie interne ÉcoleConnect"
        maxWidth="xl"
      >
        <MessagingModule />
      </Modal>
    </div>
  );
};

export default function App() {
  return (
    <RealAuthProvider>
      <AuthProvider>
        <NotificationProvider>
          <DemoProvider>
            <MainLayout />
            <ToastContainer />
          </DemoProvider>
        </NotificationProvider>
      </AuthProvider>
    </RealAuthProvider>
  );
}
