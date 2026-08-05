import React from "react";
import { Package } from "lucide-react";

export const Footer = () => {
  return (
    <footer className="bg-[#0a0f1c] text-white pt-16 pb-8 border-t border-white/10">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-1 md:col-span-2">
            <a href="#" className="flex items-center gap-2 mb-4">
              <div className="bg-secondary p-2 rounded-lg text-white">
                <Package size={24} />
              </div>
              <span className="text-2xl font-bold tracking-tight">
                Livr<span className="text-secondary">Express</span>
              </span>
            </a>
            <p className="text-gray-400 max-w-sm mb-6">
              Le service de livraison de référence à Lubumbashi. Fiable, rapide et sécurisé, conçu pour les entreprises et les particuliers.
            </p>
            <div className="flex gap-4">
              <a href="#" aria-label="Facebook" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-secondary transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
              </a>
              <a href="#" aria-label="Instagram" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-secondary transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
              </a>
              <a href="#" aria-label="Twitter" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-secondary transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path></svg>
              </a>
            </div>
          </div>
          
          <div>
            <h4 className="font-bold text-lg mb-4">Liens Rapides</h4>
            <ul className="space-y-2">
              <li><a href="#home" className="text-gray-400 hover:text-secondary transition-colors">Accueil</a></li>
              <li><a href="#about" className="text-gray-400 hover:text-secondary transition-colors">À Propos</a></li>
              <li><a href="#services" className="text-gray-400 hover:text-secondary transition-colors">Services</a></li>
              <li><a href="#pricing" className="text-gray-400 hover:text-secondary transition-colors">Tarifs</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-lg mb-4">Légal</h4>
            <ul className="space-y-2">
              <li><a href="#" className="text-gray-400 hover:text-secondary transition-colors">Mentions légales</a></li>
              <li><a href="#" className="text-gray-400 hover:text-secondary transition-colors">Politique de confidentialité</a></li>
              <li><a href="#" className="text-gray-400 hover:text-secondary transition-colors">Conditions générales</a></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-500 text-sm text-center md:text-left">
            &copy; {new Date().getFullYear()} LivrExpress. Tous droits réservés.
          </p>
          <p className="text-gray-500 text-sm">
            Fait avec ❤️ à Lubumbashi
          </p>
        </div>
      </div>
    </footer>
  );
};
