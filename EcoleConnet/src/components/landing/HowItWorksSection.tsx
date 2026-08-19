import React from 'react';
import { Settings, KeyRound, Radio } from 'lucide-react';

export const HowItWorksSection: React.FC = () => {
  const steps = [
    {
      number: '01',
      title: 'L’école configure son espace',
      description: 'L’administration enregistre les classes, les enseignants, les matières et le calendrier de l’année scolaire.',
      icon: Settings,
      color: 'bg-blue-600 text-white'
    },
    {
      number: '02',
      title: 'Les utilisateurs reçoivent leurs accès',
      description: 'Les enseignants, les parents et les élèves reçoivent leurs comptes sécurisés personnalisés.',
      icon: KeyRound,
      color: 'bg-amber-500 text-slate-950'
    },
    {
      number: '03',
      title: 'Toute la communauté reste connectée',
      description: 'Chacun accède en temps réel aux annonces, aux notes, aux présences et aux communications de l’école.',
      icon: Radio,
      color: 'bg-emerald-600 text-white'
    }
  ];

  return (
    <section id="comment-ca-marche" className="py-20 bg-slate-900 text-white border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-amber-400">
            Déploiement simple et rapide
          </h2>
          <p className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Comment ça marche ?
          </p>
          <p className="text-slate-400 text-base leading-relaxed">
            Seulement 3 étapes simples pour transformer la communication de votre établissement scolaire.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 relative">
          {steps.map((s, idx) => {
            const Icon = s.icon;
            return (
              <div
                key={idx}
                className="relative bg-slate-800/60 p-8 rounded-3xl border border-slate-700/80 hover:border-amber-500/50 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-4xl font-black text-slate-700 font-mono">{s.number}</span>
                    <div className={`p-3 rounded-2xl ${s.color} shadow-lg`}>
                      <Icon className="w-6 h-6" />
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">{s.title}</h3>
                  <p className="text-slate-300 text-sm leading-relaxed">{s.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
