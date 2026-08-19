import React from 'react';
import { Logo } from '../common/Logo';
import { MessageSquare } from 'lucide-react';
import { SCHOOL_INFO } from '../../data/mockData';

export const Footer: React.FC = () => {
  const whatsappUrl = `https://wa.me/${SCHOOL_INFO.whatsapp.replace(/[^0-9]/g, '')}?text=Bonjour%20PaTShi-Digital`;

  return (
    <footer className="bg-slate-950 text-slate-400 py-12 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8 pb-12 border-b border-slate-800">
          <div className="space-y-4 md:col-span-2">
            <Logo variant="white" size="lg" />
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              ÉcoleConnect est la solution de gestion et communication scolaire de référence créée pour connecter les directions, enseignants, parents et élèves en toute transparence.
            </p>
            <div className="pt-2">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold hover:bg-emerald-500/20 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                <span>WhatsApp PaTShi-Digital: {SCHOOL_INFO.whatsapp}</span>
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-4">Navigation</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#accueil" className="hover:text-amber-400 transition-colors">Accueil</a></li>
              <li><a href="#fonctionnalites" className="hover:text-amber-400 transition-colors">Fonctionnalités</a></li>
              <li><a href="#profils" className="hover:text-amber-400 transition-colors">Profils Utilisateurs</a></li>
              <li><a href="#comment-ca-marche" className="hover:text-amber-400 transition-colors">Comment ça marche</a></li>
              <li><a href="#contact" className="hover:text-amber-400 transition-colors">Contact</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white text-sm mb-4">Coordonnées</h4>
            <ul className="space-y-2 text-xs">
              <li>Fournisseur: PaTShi-Digital</li>
              <li>Téléphone: {SCHOOL_INFO.phone}</li>
              <li>WhatsApp: {SCHOOL_INFO.whatsapp}</li>
              <li>RD Congo / International</li>
            </ul>
          </div>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p className="font-semibold text-slate-300">
            « ÉcoleConnect — Une solution développée par PaTShi-Digital »
          </p>
          <p>© 2026 PaTShi-Digital. Tous droits réservés.</p>
        </div>
      </div>
    </footer>
  );
};
