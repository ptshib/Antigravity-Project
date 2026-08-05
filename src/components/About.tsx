import React from "react";
import { PackageOpen, Map, Users, Target } from "lucide-react";

export const About = () => {
  return (
    <section id="about" className="py-20 bg-gray-50 dark:bg-primary/5">
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex flex-col lg:flex-row gap-12 items-center">
          <div className="flex-1 w-full relative">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-4 pt-8">
                <div className="bg-white dark:bg-primary p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-800">
                  <div className="w-12 h-12 bg-secondary/10 rounded-full flex items-center justify-center mb-4">
                    <Map className="text-secondary" size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">100% Lubumbashi</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">Une expertise locale pour une logistique adaptée à notre ville.</p>
                </div>
                <div className="bg-white dark:bg-primary p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-800">
                  <div className="w-12 h-12 bg-secondary/10 rounded-full flex items-center justify-center mb-4">
                    <Users className="text-secondary" size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">+500 Clients</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">Des particuliers et entreprises nous font confiance chaque jour.</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className="bg-secondary p-6 rounded-2xl shadow-lg text-white">
                  <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-4">
                    <PackageOpen size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">+10k Colis</h3>
                  <p className="text-white/80 text-sm">Livrés avec succès depuis notre création.</p>
                </div>
                <div className="bg-white dark:bg-primary p-6 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-800">
                  <div className="w-12 h-12 bg-secondary/10 rounded-full flex items-center justify-center mb-4">
                    <Target className="text-secondary" size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Objectif 0 Retard</h3>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">La ponctualité est notre valeur fondamentale.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Plus qu'une simple <span className="text-secondary">livraison</span>, une promesse tenue.
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
              Né d'un besoin de fiabilité dans le secteur de la logistique locale, <strong>LivrExpress</strong> s'est donné pour mission de révolutionner la livraison à Lubumbashi. 
            </p>
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-8">
              Nous comprenons que derrière chaque colis, il y a une urgence, une surprise ou une nécessité. C'est pourquoi nos coursiers sont formés pour garantir non seulement la rapidité, mais aussi la sécurité absolue de vos biens.
            </p>
            
            <div className="flex items-center gap-6">
              <div className="flex -space-x-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className={`w-12 h-12 rounded-full border-2 border-white dark:border-primary flex items-center justify-center font-bold text-white shadow-sm ${i === 1 ? 'bg-blue-500' : i === 2 ? 'bg-orange-500' : i === 3 ? 'bg-green-500' : 'bg-secondary'}`}>
                    {i === 4 ? "+50" : ["JD", "MK", "AL"][i-1]}
                  </div>
                ))}
              </div>
              <div className="text-sm">
                <p className="font-bold">Une équipe dévouée</p>
                <p className="text-gray-500">Prête à vous servir 7j/7</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
