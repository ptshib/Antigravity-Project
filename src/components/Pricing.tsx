"use client";

import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "./ui/Button";

export const Pricing = () => {
  const plans = [
    {
      name: "Standard",
      price: "2.000",
      currency: "FC",
      desc: "Idéal pour les petites courses sans urgence.",
      features: ["Livraison en 24h", "Colis jusqu'à 2kg", "Suivi basique", "Support par email"],
      highlighted: false,
    },
    {
      name: "Express",
      price: "5.000",
      currency: "FC",
      desc: "La solution la plus populaire pour vos urgences.",
      features: ["Livraison en - de 2h", "Colis jusqu'à 5kg", "Suivi en temps réel", "Support prioritaire WhatsApp", "Preuve de livraison"],
      highlighted: true,
    },
    {
      name: "Business",
      price: "Sur devis",
      currency: "",
      desc: "Pour les e-commerçants et entreprises.",
      features: ["Livraisons multiples", "Collecte des fonds (COD)", "Dashboard dédié", "Agent de compte exclusif", "Assurance premium"],
      highlighted: false,
    }
  ];

  return (
    <section id="pricing" className="py-20 relative">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Des tarifs <span className="text-secondary">simples et clairs</span>
          </h2>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Pas de frais cachés. Choisissez l'offre qui correspond à vos besoins.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={index}
              whileHover={{ y: -10 }}
              className={`relative flex flex-col p-8 rounded-3xl ${
                plan.highlighted 
                ? "bg-primary text-white shadow-2xl scale-105 md:scale-110 z-10" 
                : "bg-white dark:bg-primary/20 border border-gray-100 dark:border-gray-800 shadow-lg"
              }`}
            >
              {plan.highlighted && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  <span className="bg-secondary text-white text-xs font-bold uppercase tracking-wider py-1 px-3 rounded-full">
                    Le plus populaire
                  </span>
                </div>
              )}
              
              <div className="mb-6">
                <h3 className={`text-xl font-bold mb-2 ${!plan.highlighted && "text-primary dark:text-white"}`}>
                  {plan.name}
                </h3>
                <p className={`${plan.highlighted ? "text-gray-300" : "text-gray-500 dark:text-gray-400"} text-sm h-10`}>
                  {plan.desc}
                </p>
              </div>
              
              <div className="mb-8 flex items-baseline gap-2">
                <span className={`text-4xl font-extrabold ${!plan.highlighted && "text-primary dark:text-white"}`}>
                  {plan.price}
                </span>
                {plan.currency && (
                  <span className={`${plan.highlighted ? "text-gray-300" : "text-gray-500 dark:text-gray-400"} font-medium`}>
                    {plan.currency}
                  </span>
                )}
              </div>
              
              <ul className="flex-1 space-y-4 mb-8">
                {plan.features.map((feature, fIdx) => (
                  <li key={fIdx} className="flex items-center gap-3">
                    <Check size={20} className={plan.highlighted ? "text-secondary" : "text-secondary"} />
                    <span className={plan.highlighted ? "text-gray-200" : "text-gray-700 dark:text-gray-300"}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
              
              <Button 
                variant={plan.highlighted ? "primary" : "outline"} 
                className="w-full"
              >
                Choisir ce plan
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
