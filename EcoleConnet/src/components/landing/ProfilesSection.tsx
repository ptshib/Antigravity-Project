import React from 'react';
import { ShieldCheck, GraduationCap, Users, BookOpen, Check } from 'lucide-react';

export const ProfilesSection: React.FC = () => {
  const profiles = [
    {
      id: 'admin',
      role: 'Administration',
      badge: 'Pilotage & Supervision',
      icon: ShieldCheck,
      color: 'border-rose-500/20 bg-rose-50/50 text-rose-700',
      iconBg: 'bg-rose-500 text-white',
      features: [
        'Gestion globale des élèves, enseignants et parents',
        'Suivi de la trésorerie et des paiements de scolarité',
        'Publication des annonces officielles et événements',
        'Statistiques de présence et tableaux de bord en temps réel'
      ]
    },
    {
      id: 'teacher',
      role: 'Enseignants',
      badge: 'Gestion Pédagogique',
      icon: GraduationCap,
      color: 'border-emerald-500/20 bg-emerald-50/50 text-emerald-700',
      iconBg: 'bg-emerald-600 text-white',
      features: [
        'Saisie rapide des présences et retards du jour',
        'Publication des devoirs et cahiers de texte interactifs',
        'Attribution des notes avec appréciations pédagogiques',
        'Messagerie directe avec l’administration et les parents'
      ]
    },
    {
      id: 'parent',
      role: 'Parents',
      badge: 'Accompagnement Famille',
      icon: Users,
      color: 'border-amber-500/20 bg-amber-50/50 text-amber-700',
      iconBg: 'bg-amber-500 text-slate-950',
      features: [
        'Sélecteur multi-enfants pour basculer facilement entre les frères et sœurs',
        'Suivi instantané des résultats scolaires et appréciations',
        'Paiement et vérification des reçus de frais de scolarité',
        'Réception directe des notifications et convocations'
      ]
    },
    {
      id: 'student',
      role: 'Élèves',
      badge: 'Espace d’Apprentissage',
      icon: BookOpen,
      color: 'border-sky-500/20 bg-sky-50/50 text-sky-700',
      iconBg: 'bg-sky-500 text-white',
      features: [
        'Consultation de l’emploi du temps quotidien et des salles',
        'Visualisation des devoirs à rendre avec rappels',
        'Consultation du carnet de notes et moyenne générale',
        'Téléchargement des cours et documents partagés'
      ]
    }
  ];

  return (
    <section id="profils" className="py-20 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-amber-600">
            Adapté à chaque acteur de l’école
          </h2>
          <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Quatre Espaces Dédiés & Sur Mesure
          </p>
          <p className="text-slate-600 text-base leading-relaxed">
            Chaque utilisateur bénéficie d’une interface optimisée avec ses propres menus, autorisations et outils de travail.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {profiles.map(p => {
            const Icon = p.icon;
            return (
              <div
                key={p.id}
                className="rounded-3xl border border-slate-200 p-8 shadow-xs hover:shadow-lg transition-all bg-slate-50/40 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className={`p-3 rounded-2xl ${p.iconBg} shadow-md`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <h3 className="text-2xl font-extrabold text-slate-900">{p.role}</h3>
                    </div>
                    <span className={`text-xs font-bold px-3 py-1 rounded-full border ${p.color}`}>
                      {p.badge}
                    </span>
                  </div>

                  <ul className="space-y-3 mb-6">
                    {p.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-3 text-sm text-slate-700 font-medium">
                        <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
