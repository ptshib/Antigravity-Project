import React from 'react';
import { ArrowRight, Sparkles, ShieldCheck, CheckCircle2, GraduationCap, Users, School, MessageSquare } from 'lucide-react';

interface HeroSectionProps {
  onGoToDemo: () => void;
  onDiscover: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onGoToDemo, onDiscover }) => {
  return (
    <section id="accueil" className="relative bg-slate-950 text-white overflow-hidden py-16 lg:py-24 border-b border-slate-800">
      {/* Background ambient lighting gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full filter blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full filter blur-3xl pointer-events-none"></div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Headline & Action Buttons */}
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-900/60 border border-blue-700/60 text-amber-400 text-xs font-bold shadow-xs">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Plateforme Éducative Nouvelle Génération</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
              <span className="text-white">École</span>
              <span className="text-amber-500">Connect</span>
            </h1>

            <p className="text-xl sm:text-2xl font-medium text-blue-200 tracking-wide">
              « L’école, les parents et les élèves toujours connectés. »
            </p>

            <p className="text-base text-slate-300 max-w-2xl leading-relaxed">
              ÉcoleConnect est la solution digitale complète développée par{' '}
              <strong className="text-amber-400 font-semibold">PaTShi-Digital</strong> pour moderniser la communication scolaire,
              centraliser le suivi des notes, des présences et des devoirs, et offrir une expérience fluide à toute la communauté éducative.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 pt-4">
              <button
                onClick={onGoToDemo}
                className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-extrabold text-base shadow-xl hover:shadow-amber-500/20 transition-all flex items-center justify-center gap-3 cursor-pointer"
              >
                <span>Accéder à la démo</span>
                <ArrowRight className="w-5 h-5" />
              </button>

              <button
                onClick={onDiscover}
                className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-slate-800/80 hover:bg-slate-800 text-white font-bold text-base border border-slate-700 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Découvrir la solution</span>
              </button>
            </div>

            {/* Highlights */}
            <div className="pt-6 grid grid-cols-3 gap-4 border-t border-slate-800/80 text-left">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Compatible mobile, tablette et ordinateur</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Zéro Papier</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Accès selon le rôle</span>
              </div>
            </div>
          </div>

          {/* Right Column: Visual Connectivity Illustration */}
          <div className="lg:col-span-5 relative">
            <div className="relative mx-auto max-w-md bg-gradient-to-b from-slate-900 to-slate-950 p-6 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden">
              {/* Central Hub graphic */}
              <div className="text-center pb-6 border-b border-slate-800">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center mb-3">
                  <School className="w-8 h-8 text-blue-400" />
                </div>
                <h3 className="font-bold text-sm text-white">Complexe Scolaire Les Horizons</h3>
                <p className="text-[11px] text-slate-400">Année Scolaire 2026–2027</p>
              </div>

              {/* 4 Connected Nodes Grid */}
              <div className="grid grid-cols-2 gap-3 pt-6">
                <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/60 flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Admin</p>
                    <p className="text-[10px] text-slate-400">Pilotage global</p>
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/60 flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Enseignants</p>
                    <p className="text-[10px] text-slate-400">Notes & Devoirs</p>
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/60 flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Parents</p>
                    <p className="text-[10px] text-slate-400">Suivi en direct</p>
                  </div>
                </div>

                <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/60 flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">Élèves</p>
                    <p className="text-[10px] text-slate-400">Cours & Emploi</p>
                  </div>
                </div>
              </div>

              {/* Pulsing Central Connection Status */}
              <div className="mt-6 p-3 rounded-xl bg-blue-950/80 border border-blue-800/60 text-center flex items-center justify-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                <span className="text-xs font-semibold text-blue-200">
                  Une communauté scolaire mieux connectée
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
