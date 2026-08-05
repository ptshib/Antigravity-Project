"use client";

import React from "react";
import { motion } from "framer-motion";
import { Zap, Truck, ShoppingBag, Briefcase } from "lucide-react";

export const Services = () => {
  const services = [
    {
      icon: <Zap size={32} />,
      title: "Livraison Express",
      desc: "Idéal pour les plis urgents. Votre colis est récupéré et livré en moins de 2 heures partout en ville.",
      color: "from-orange-400 to-secondary"
    },
    {
      icon: <ShoppingBag size={32} />,
      title: "E-commerce",
      desc: "La solution parfaite pour les boutiques en ligne. Nous gérons vos livraisons clients avec paiement à la réception.",
      color: "from-blue-400 to-blue-600"
    },
    {
      icon: <Truck size={32} />,
      title: "Colis Volumineux",
      desc: "Déménagement léger ou transport de gros électroménager avec nos véhicules utilitaires adaptés.",
      color: "from-emerald-400 to-emerald-600"
    },
    {
      icon: <Briefcase size={32} />,
      title: "Course Corporate",
      desc: "Service dédié aux entreprises pour le transfert sécurisé de documents confidentiels entre succursales.",
      color: "from-purple-400 to-purple-600"
    }
  ];

  return (
    <section id="services" className="py-20 relative">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Nos <span className="text-secondary">Services</span>
          </h2>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Des solutions sur mesure pour répondre à tous vos besoins de transport et de logistique.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {services.map((service, index) => (
            <motion.div
              key={index}
              whileHover={{ y: -10 }}
              className="bg-white dark:bg-primary/40 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-xl hover:shadow-2xl transition-all"
            >
              <div className={`w-16 h-16 rounded-2xl mb-6 flex items-center justify-center text-white bg-gradient-to-br ${service.color}`}>
                {service.icon}
              </div>
              <h3 className="text-xl font-bold mb-3">{service.title}</h3>
              <p className="text-gray-600 dark:text-gray-400">
                {service.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};
