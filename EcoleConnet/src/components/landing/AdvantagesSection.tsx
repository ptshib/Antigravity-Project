import React from 'react';
import { MessageSquare, Clock, Bell, Sliders, ShieldCheck, Smartphone } from 'lucide-react';

export const AdvantagesSection: React.FC = () => {
  const advantages = [
    {
      icon: MessageSquare,
      title: 'Communication centralisée',
      description: 'Regroupez toutes les annonces, circulaires et messages en un seul endroit sécurisé sans perte d’information.',
      color: 'bg-blue-50 text-blue-600'
    },
    {
      icon: Clock,
      title: 'Suivi scolaire en temps réel',
      description: 'Accédez instantanément aux notes, appréciations, cahiers de texte et présences de chaque élève.',
      color: 'bg-amber-50 text-amber-600'
    },
    {
      icon: Bell,
      title: 'Notifications rapides',
      description: 'Alertez immédiatement les parents en cas d’absence, d’événement important ou d’urgence scolaire.',
      color: 'bg-rose-50 text-rose-600'
    },
    {
      icon: Sliders,
      title: 'Gestion simplifiée',
      description: 'Automatisez la création des emplois du temps, des bulletins et le suivi des frais de scolarité.',
      color: 'bg-emerald-50 text-emerald-600'
    },
    {
      icon: ShieldCheck,
      title: 'Accès sécurisé',
      description: 'Contrôlez les autorisations et préservez la confidentialité des données selon le rôle attribué.',
      color: 'bg-purple-50 text-purple-600'
    },
    {
      icon: Smartphone,
      title: 'Accessible partout',
      description: 'Profitez d’une interface parfaitement fluide sur ordinateur, tablette et téléphone mobile.',
      color: 'bg-sky-50 text-sky-600'
    }
  ];

  return (
    <section id="fonctionnalites" className="py-20 bg-slate-50 border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-blue-600">
            Pourquoi choisir ÉcoleConnect ?
          </h2>
          <p className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Les Avantages Clés pour Votre Établissement
          </p>
          <p className="text-slate-600 text-base leading-relaxed">
            Une solution pensée pour éliminer la paperasse, fluidifier le dialogue école-familles et valoriser l’image numérique de votre école.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {advantages.map((adv, idx) => {
            const Icon = adv.icon;
            return (
              <div
                key={idx}
                className="bg-white p-8 rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
              >
                <div className={`w-14 h-14 rounded-2xl ${adv.color} flex items-center justify-center mb-6`}>
                  <Icon className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{adv.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{adv.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
