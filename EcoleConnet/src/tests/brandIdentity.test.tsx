import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LandingNavbar } from '../components/landing/LandingNavbar';
import { Footer } from '../components/landing/Footer';
import { LoginPage } from '../pages/auth/LoginPage';
import { TeacherPortalSidebar } from '../components/teacher/portal/TeacherPortalSidebar';
import { ParentPortalSidebar } from '../components/parent/portal/ParentPortalSidebar';
import { StudentPortalSidebar } from '../components/student/portal/StudentPortalSidebar';
import { PaymentReceiptModal } from '../components/admin/finance/PaymentReceiptModal';
import { Logo } from '../components/common/Logo';

// Mocks for contexts/services where needed
vi.mock('../contexts/RealAuthContext', () => ({
  useRealAuth: () => ({
    user: null,
    profile: null,
    school: null,
    signOutReal: vi.fn(),
  }),
}));

vi.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    showToast: vi.fn(),
  }),
}));

describe('Suite de Validation de l’Identité de Marque — ÉcoleLink', () => {
  afterEach(() => {
    cleanup();
  });

  it('1. Landing page affiche ÉcoleLink', () => {
    render(<LandingNavbar onGoToDemo={() => {}} onGoToLogin={() => {}} />);
    expect(screen.getByText('École')).toBeInTheDocument();
    expect(screen.getByText('Link')).toBeInTheDocument();
  });

  it('2. Login affiche ÉcoleLink', () => {
    render(<LoginPage onGoToDemo={() => {}} onGoToLanding={() => {}} onGoToForgotPassword={() => {}} />);
    expect(screen.getByText(/Les comptes ÉcoleLink sont fournis par votre établissement scolaire\./i)).toBeInTheDocument();
    expect(screen.getByText(/ÉcoleLink — Une solution développée par/i)).toBeInTheDocument();
  });

  it('3. Logo global affiche ÉcoleLink', () => {
    render(<Logo size="md" showSubtitle />);
    expect(screen.getByText('École')).toBeInTheDocument();
    expect(screen.getByText('Link')).toBeInTheDocument();
  });

  it('4. Sidebar Enseignant affiche ÉcoleLink en fallback', () => {
    render(
      <TeacherPortalSidebar
        activeTab="overview"
        setActiveTab={() => {}}
        isOpenMobile={false}
        onCloseMobile={() => {}}
        onSignOut={() => {}}
        teacherName="Grace Kabeya"
        schoolName=""
      />
    );
    expect(screen.getByText('ÉcoleLink')).toBeInTheDocument();
  });

  it('5. Sidebar Parent affiche ÉcoleLink en fallback', () => {
    render(
      <ParentPortalSidebar
        activeTab="children"
        setActiveTab={() => {}}
        isOpenMobile={false}
        onCloseMobile={() => {}}
        onSignOut={() => {}}
        parentName="Test Parent"
        schoolName=""
      />
    );
    expect(screen.getByText('ÉcoleLink')).toBeInTheDocument();
  });

  it('6. Sidebar Élève affiche ÉcoleLink en fallback', () => {
    render(
      <StudentPortalSidebar
        activeTab="resultats"
        setActiveTab={() => {}}
        isOpenMobile={false}
        onCloseMobile={() => {}}
        onSignOut={() => {}}
        studentName="Joël Kalala"
        schoolName=""
      />
    );
    expect(screen.getByText('ÉcoleLink')).toBeInTheDocument();
  });

  it('7. Reçu frontend affiche ÉcoleLink', () => {
    const mockReceipt = {
      receipt_id: 'rec-123',
      receipt_number: 'REC-2026-000001',
      invoice_number: 'INV-2026-000007',
      payment_number: 'PAY-2026-000001',
      amount: 10,
      currency: 'USD',
      payment_date: '2026-09-28',
      payment_method: 'cash',
      recorded_by_name: 'Caissier',
      student_name: 'Joël Kalala',
      student_number: 'ELV-2026-004',
      class_name: '1B',
      status: 'active',
      is_idempotent_replay: false,
    };

    render(
      <PaymentReceiptModal
        isOpen={true}
        onClose={() => {}}
        receipt={mockReceipt as any}
        schoolName="Complexe Scolaire les Petits Anges"
      />
    );

    expect(screen.getByText(/Reçu officiel généré par le système bancaire \/ caisse d'ÉcoleLink/i)).toBeInTheDocument();
    expect(screen.getByText(/Document numérique certifié ÉcoleLink/i)).toBeInTheDocument();
  });

  it('8. Aucun composant frontend de production ne rend encore ÉcoleConnect', () => {
    const { container: landingNav } = render(<LandingNavbar onGoToDemo={() => {}} onGoToLogin={() => {}} />);
    expect(landingNav.textContent).not.toContain('ÉcoleConnect');
    cleanup();

    const { container: footer } = render(<Footer />);
    expect(footer.textContent).not.toContain('ÉcoleConnect');
    cleanup();

    const { container: login } = render(<LoginPage onGoToDemo={() => {}} onGoToLanding={() => {}} onGoToForgotPassword={() => {}} />);
    expect(login.textContent).not.toContain('ÉcoleConnect');
    cleanup();
  });

  it('9. La signature PaTShi-Digital est conservée', () => {
    render(<Footer />);
    expect(screen.getByText(/par PaTShi-Digital/i)).toBeInTheDocument();
  });

  it('10. Les noms réels des établissements restent prioritaires lorsqu’ils sont disponibles', () => {
    render(
      <TeacherPortalSidebar
        activeTab="overview"
        setActiveTab={() => {}}
        isOpenMobile={false}
        onCloseMobile={() => {}}
        onSignOut={() => {}}
        teacherName="Grace Kabeya"
        schoolName="Complexe Scolaire Saint-Joseph"
      />
    );
    expect(screen.getByText('Complexe Scolaire Saint-Joseph')).toBeInTheDocument();
    expect(screen.queryByText('ÉcoleLink')).not.toBeInTheDocument();
  });
});
