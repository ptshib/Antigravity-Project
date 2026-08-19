import React from 'react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';
import { Logo } from '../components/common/Logo';
import { ShieldCheck, GraduationCap, Users, BookOpen, ArrowRight, Sparkles } from 'lucide-react';
import { DEMO_USERS } from '../data/mockData';

interface DemoSelectorPageProps {
  onSelectRole: (role: UserRole) => void;
  onGoToLanding: () => void;
}

export const DemoSelectorPage: React.FC<DemoSelectorPageProps> = ({ onSelectRole, onGoToLanding }) => {
  const { loginAs } = useAuth();

  const handleChooseRole = (r: UserRole) => {
    loginAs(r);
    onSelectRole(r);
  };

  const roles = [
    {
      id: 'admin' as UserRole,
      title: 'Administrateur',
      user: DEMO_USERS.admin,
      description: 'Accédez à la supervision globale de l’établissement, statistiques de présence, gestion des frais et paramétrages.',
      icon: ShieldCheck,
      color: 'from-rose-500 to-rose-600',
      badge: 'Direction Général',
      accentBorder: 'hover:border-rose-500'
    },
    {
      id: 'teacher' as UserRole,
      title: 'Enseignant',
      user: DEMO_USERS.teacher,
      description: 'Gérez vos classes (1re Sec A), saisissez les présences en direct, publiez des devoirs et enregistrez les notes.',
      icon: GraduationCap,
      color: 'from-emerald-500 to-emerald-600',
      badge: 'Prof. Titulaire',
      accentBorder: 'hover:border-emerald-500'
    },
    {
      id: 'parent' as UserRole,
      title: 'Parent d’élèves',
      user: DEMO_USERS.parent,
      description: 'Suivez la scolarité de vos 2 enfants (Marc & Grace Kabedi), vos paiements de scolarité, leurs devoirs et bulletins.',
      icon: Users,
      color: 'from-amber-500 to-amber-600',
      badge: 'Compte 2 Enfants',
      accentBorder: 'hover:border-amber-500'
    },
    {
      id: 'student' as UserRole,
      title: 'Élève',
      user: DEMO_USERS.student,
      description: 'Consultez votre emploi du temps, vos devoirs à faire, votre moyenne générale et communiquez avec vos enseignants.',
      icon: BookOpen,
      color: 'from-sky-500 to-sky-600',
      badge: '1re Secondaire A',
      accentBorder: 'hover:border-sky-500'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full filter blur-3xl pointer-events-none"></div>

      {/* Top Bar */}
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between z-10">
        <Logo variant="white" size="md" showSubtitle />
        <button
          onClick={onGoToLanding}
          className="text-xs text-slate-400 hover:text-white font-semibold underline underline-offset-4 cursor-pointer"
        >
          Retourner au site vitrine
        </button>
      </div>

      {/* Content Center */}
      <div className="max-w-6xl mx-auto w-full my-auto py-12 z-10 text-center space-y-10">
        <div className="space-y-4 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sélection de profil démonstration</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
            Choisissez un Rôle à Simuler
          </h1>

          <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
            Testez l’expérience utilisateur d’<strong>ÉcoleConnect</strong> en vous connectant instantanément sous l’un des quatre profils du <em>Complexe Scolaire Les Horizons</em>.
          </p>
        </div>

        {/* 4 Cards Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
          {roles.map(r => {
            const Icon = r.icon;
            return (
              <div
                key={r.id}
                className={`bg-slate-900/90 rounded-3xl p-6 border border-slate-800 shadow-xl transition-all duration-300 hover:-translate-y-2 flex flex-col justify-between ${r.accentBorder}`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className={`p-3.5 rounded-2xl bg-gradient-to-tr ${r.color} text-slate-950 shadow-md`}>
                      <Icon className="w-6 h-6 stroke-[2.5]" />
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      {r.badge}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xl font-bold text-white">{r.title}</h3>
                    <p className="text-xs font-semibold text-amber-400 mt-0.5">{r.user.name}</p>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">{r.description}</p>
                </div>

                <button
                  onClick={() => handleChooseRole(r.id)}
                  className="mt-6 w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-extrabold text-xs shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer group"
                >
                  <span>Tester comme {r.title.toLowerCase()}</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Info */}
      <div className="text-center text-xs text-slate-500 z-10 pt-6">
        <p>ÉcoleConnect — Une solution développée par PaTShi-Digital (+243 819 883 084 / WhatsApp +420 776 308 018)</p>
      </div>
    </div>
  );
};
