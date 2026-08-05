import React from "react";
import { Button } from "./ui/Button";
import { Phone, Mail, MapPin } from "lucide-react";

export const Contact = () => {
  return (
    <section id="contact" className="py-20 bg-primary text-white relative overflow-hidden">
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="flex flex-col lg:flex-row gap-12">
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Prêt à expédier ? <span className="text-secondary">Contactez-nous</span>
            </h2>
            <p className="text-gray-300 mb-10 text-lg">
              Notre équipe est prête à prendre en charge votre colis dès maintenant.
            </p>
            
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-secondary">
                  <Phone size={24} />
                </div>
                <div>
                  <div className="text-sm text-gray-400">Appelez-nous ou WhatsApp</div>
                  <div className="text-xl font-bold">+243 99 123 4567</div>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-secondary">
                  <Mail size={24} />
                </div>
                <div>
                  <div className="text-sm text-gray-400">Écrivez-nous</div>
                  <div className="text-xl font-bold">contact@livrexpress.cd</div>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-secondary">
                  <MapPin size={24} />
                </div>
                <div>
                  <div className="text-sm text-gray-400">Notre bureau principal</div>
                  <div className="text-xl font-bold">Avenue Kasaï, Lubumbashi</div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex-1 w-full max-w-md mx-auto lg:mx-0">
            <div className="bg-white rounded-2xl p-8 text-primary shadow-2xl">
              <h3 className="text-2xl font-bold mb-6 text-center">Demander un devis</h3>
              <form className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Nom complet</label>
                  <input type="text" className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent" placeholder="Jean Dupont" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Numéro de téléphone</label>
                  <input type="tel" className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent" placeholder="+243..." />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Type de colis</label>
                  <select className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-secondary focus:border-transparent">
                    <option>Document / Pli</option>
                    <option>Colis Standard (1-5kg)</option>
                    <option>Colis Lourd (+5kg)</option>
                    <option>Autre</option>
                  </select>
                </div>
                <Button className="w-full mt-4 h-12 text-lg">Envoyer la demande</Button>
                <p className="text-xs text-center text-gray-500 mt-4">Nous vous répondrons dans les 5 minutes.</p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
