import React, { useState } from 'react';
import { Logo } from '../common/Logo';
import { Phone, Menu, X, Sparkles } from 'lucide-react';
import { SCHOOL_INFO } from '../../data/mockData';

interface LandingNavbarProps {
  onGoToDemo: () => void;
  onGoToLogin: () => void;
}

export const LandingNavbar: React.FC<LandingNavbarProps> = ({ onGoToDemo, onGoToLogin }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const whatsappUrl = `https://wa.me/${SCHOOL_INFO.whatsapp.replace(/[^0-9]/g, '')}?text=Bonjour%20PaTShi-Digital,%20je%20souhaite%20en%20savoir%20plus%20sur%20ÉcoleConnect`;

  return (
    <nav className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
        <Logo variant="white" size="md" showSubtitle />

        {/* Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
          <a href="#accueil" className="hover:text-white transition-colors">Accueil</a>
          <a href="#fonctionnalites" className="hover:text-white transition-colors">Fonctionnalités</a>
          <a href="#comment-ca-marche" className="hover:text-white transition-colors">Comment ça marche</a>
          <a href="#profils" className="hover:text-white transition-colors">Profils</a>
          <a href="#contact" className="hover:text-white transition-colors">Contact</a>
        </div>

        {/* Action Buttons */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold border border-emerald-500/20 transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </a>

          <button
            onClick={onGoToDemo}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Voir la démonstration</span>
          </button>

          <button
            onClick={onGoToLogin}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md transition-colors cursor-pointer"
          >
            Se connecter
          </button>
        </div>

        {/* Mobile Hamburger */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 text-slate-300 hover:text-white"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-slate-900 border-b border-slate-800 p-5 space-y-4 animate-fade-in">
          <div className="flex flex-col space-y-3 font-medium text-slate-300 text-sm">
            <a href="#accueil" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Accueil</a>
            <a href="#fonctionnalites" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Fonctionnalités</a>
            <a href="#comment-ca-marche" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Comment ça marche</a>
            <a href="#profils" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Profils</a>
            <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="hover:text-white">Contact</a>
          </div>
          <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
            <button
              onClick={() => { setMobileMenuOpen(false); onGoToDemo(); }}
              className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs text-center cursor-pointer"
            >
              Voir la démonstration
            </button>
            <button
              onClick={() => { setMobileMenuOpen(false); onGoToLogin(); }}
              className="w-full py-2.5 rounded-xl bg-blue-600 text-white font-bold text-xs text-center cursor-pointer"
            >
              Se connecter
            </button>
          </div>
        </div>
      )}
    </nav>
  );
};
