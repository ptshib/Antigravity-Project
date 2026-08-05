"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Package, Menu, X } from "lucide-react";
import { Button } from "./ui/Button";

export const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { name: "Accueil", href: "#home" },
    { name: "À Propos", href: "#about" },
    { name: "Services", href: "#services" },
    { name: "Tarifs", href: "#pricing" },
    { name: "Contact", href: "#contact" },
  ];

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-white/80 dark:bg-primary/90 backdrop-blur-md shadow-sm py-3"
          : "bg-transparent py-5"
      }`}
    >
      <div className="container mx-auto px-4 md:px-6">
        <div className="flex items-center justify-between">
          <a href="#" className="flex items-center gap-2 group">
            <div className="bg-secondary p-2 rounded-lg text-white group-hover:bg-secondary-hover transition-colors">
              <Package size={24} />
            </div>
            <span className={`text-2xl font-bold tracking-tight ${isScrolled ? "text-primary dark:text-white" : "text-primary dark:text-white"}`}>
              Livr<span className="text-secondary">Express</span>
            </span>
          </a>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <div className="flex items-center gap-6">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-secondary dark:hover:text-secondary transition-colors"
                >
                  {link.name}
                </a>
              ))}
            </div>
            <Link href="/demande">
              <Button size="sm">Demander une livraison</Button>
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden text-primary dark:text-white p-2"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white dark:bg-primary border-t dark:border-gray-800"
          >
            <div className="flex flex-col px-4 py-6 gap-4">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg font-medium text-primary dark:text-white hover:text-secondary"
                >
                  {link.name}
                </a>
              ))}
              <Link href="/demande" onClick={() => setIsMobileMenuOpen(false)} className="w-full mt-4">
                <Button className="w-full">Demander une livraison</Button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
};
