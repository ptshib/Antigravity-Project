import React from "react";
import { CheckCircle2 } from "lucide-react";

export const Features = () => {
  const features = [
    "Couverture complète de Lubumbashi",
    "Suivi en temps réel de votre colis",
    "Service client réactif 7j/7",
    "Paiement à la livraison possible",
    "Tarifs transparents et compétitifs",
    "Emballage sécurisé (sur demande)"
  ];

  return (
    <section className="py-20 bg-gray-50 dark:bg-primary/5">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Pourquoi choisir <span className="text-secondary">LivrExpress</span> ?
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
              Nous n'avons pas seulement créé un service de livraison, nous avons mis en place une infrastructure logistique pour faciliter le quotidien des Lushois.
            </p>
            
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {features.map((feature, idx) => (
                <li key={idx} className="flex items-center gap-3">
                  <CheckCircle2 className="text-secondary flex-shrink-0" size={24} />
                  <span className="text-gray-700 dark:text-gray-300 font-medium">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
          
          <div className="flex-1 w-full">
            <div className="relative aspect-square md:aspect-[4/3] bg-primary rounded-3xl overflow-hidden shadow-2xl">
              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1617511470404-5f8eb04a2ea2?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center opacity-40 mix-blend-overlay"></div>
              <div className="absolute inset-0 bg-gradient-to-t from-primary/90 to-transparent"></div>
              
              <div className="absolute bottom-8 left-8 right-8">
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-6 border border-white/20 text-white">
                  <div className="text-4xl font-bold text-secondary mb-2">99.8%</div>
                  <div className="text-lg font-semibold">Taux de satisfaction</div>
                  <p className="text-sm text-gray-300 mt-2">Calculé sur nos 10 000 dernières courses à travers la ville.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
