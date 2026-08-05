"use client";

import React from "react";
import { Star } from "lucide-react";

export const Testimonials = () => {
  const reviews = [
    {
      name: "Marc T.",
      role: "Gérant de boutique en ligne",
      content: "Depuis que je travaille avec LivrExpress, mes clients sont ravis. Les colis arrivent toujours à temps et les livreurs sont très courtois. Une vraie différence à Lubumbashi !",
      rating: 5,
    },
    {
      name: "Sarah K.",
      role: "Particulier",
      content: "J'avais oublié un document important à la maison. Le service express a été incroyable : document récupéré et livré à mon bureau en moins de 45 minutes.",
      rating: 5,
    },
    {
      name: "David M.",
      role: "Restaurateur",
      content: "La rapidité est cruciale pour nous. LivrExpress nous a mis à disposition un livreur dédié pendant nos heures de pointe. Le service est impeccable et les prix très corrects.",
      rating: 4,
    }
  ];

  return (
    <section className="py-20 bg-gray-50 dark:bg-primary/5">
      <div className="container mx-auto px-4 md:px-6">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Ils nous font <span className="text-secondary">confiance</span>
          </h2>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Découvrez ce que nos clients disent de notre service.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {reviews.map((review, index) => (
            <div key={index} className="bg-white dark:bg-primary p-8 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-800 flex flex-col h-full">
              <div className="flex gap-1 mb-4 text-secondary">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={18} fill={i < review.rating ? "currentColor" : "none"} className={i < review.rating ? "text-secondary" : "text-gray-300"} />
                ))}
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-6 flex-1 italic">
                "{review.content}"
              </p>
              <div>
                <div className="font-bold text-primary dark:text-white">{review.name}</div>
                <div className="text-sm text-gray-500">{review.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
