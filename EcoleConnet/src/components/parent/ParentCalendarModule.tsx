import React, { useEffect, useState, useRef, useMemo } from 'react';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  AlertCircle, 
  RefreshCw, 
  Tag, 
  BookOpen, 
  Trophy, 
  Users, 
  Palmtree, 
  Sparkles,
  Info
} from 'lucide-react';
import { 
  fetchParentStudentCalendar, 
  type ParentCalendarData, 
  type SchoolEventType 
} from '../../services/parentCalendarService';

interface ParentCalendarModuleProps {
  studentId: string;
}

export const ParentCalendarModule: React.FC<ParentCalendarModuleProps> = ({ studentId }) => {
  const [data, setData] = useState<ParentCalendarData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('all');

  // Réf de protection contre les réponses asynchrones obsolètes
  const activeStudentIdRef = useRef<string>(studentId);

  useEffect(() => {
    activeStudentIdRef.current = studentId;
    let isCancelled = false;

    async function loadCalendar() {
      if (!studentId) return;

      setLoading(true);
      setError(null);
      // Réinitialiser les données immédiatement pour éviter d'afficher le calendrier du précédent enfant
      setData(null);

      try {
        const result = await fetchParentStudentCalendar(studentId);

        // Si l'enfant a changé entre-temps ou si l'effet a été nettoyé, ignorer le résultat
        if (isCancelled || activeStudentIdRef.current !== studentId) {
          return;
        }

        setData(result);
      } catch (err: any) {
        if (isCancelled || activeStudentIdRef.current !== studentId) {
          return;
        }
        console.error('[ParentCalendarModule] Erreur de chargement:', err);
        setError(err.message || 'Impossible de charger le calendrier scolaire.');
      } finally {
        if (!isCancelled && activeStudentIdRef.current === studentId) {
          setLoading(false);
        }
      }
    }

    loadCalendar();

    return () => {
      isCancelled = true;
    };
  }, [studentId]);

  // Filtrage des événements par type
  const filteredEvents = useMemo(() => {
    if (!data?.events) return [];
    if (selectedType === 'all') return data.events;
    return data.events.filter(e => e.event_type === selectedType);
  }, [data?.events, selectedType]);

  // Helper de formatage de date
  const formatDateRange = (startDateStr: string, endDateStr: string, isAllDay: boolean) => {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    const startFormatted = start.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const endFormatted = end.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const sameDay = startFormatted === endFormatted;

    if (sameDay) {
      if (isAllDay) {
        return startFormatted;
      }
      const startTime = start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const endTime = end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `${startFormatted} • ${startTime} - ${endTime}`;
    }

    return `Du ${startFormatted} au ${endFormatted}`;
  };

  const getEventTypeBadge = (type: SchoolEventType) => {
    switch (type) {
      case 'academic':
        return {
          label: 'Académique',
          icon: BookOpen,
          className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        };
      case 'sports':
        return {
          label: 'Sport & Culture',
          icon: Trophy,
          className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        };
      case 'meeting':
        return {
          label: 'Réunion',
          icon: Users,
          className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        };
      case 'holiday':
        return {
          label: 'Congés / Vacances',
          icon: Palmtree,
          className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        };
      case 'event':
      default:
        return {
          label: 'Événement',
          icon: Sparkles,
          className: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        };
    }
  };

  // 1. État de chargement (Skeleton)
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-2">
            <div className="h-6 w-48 bg-slate-800 rounded-lg"></div>
            <div className="h-4 w-64 bg-slate-800/60 rounded-md"></div>
          </div>
          <div className="h-10 w-36 bg-slate-800 rounded-xl"></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="bg-slate-900/50 border border-slate-800/60 rounded-3xl p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div className="h-5 w-28 bg-slate-800 rounded-md"></div>
                <div className="h-5 w-20 bg-slate-800/50 rounded-full"></div>
              </div>
              <div className="h-6 w-3/4 bg-slate-800 rounded-md"></div>
              <div className="h-4 w-full bg-slate-800/40 rounded-md"></div>
              <div className="h-4 w-1/2 bg-slate-800/30 rounded-md"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 2. État d'erreur / Accès non autorisé
  if (error) {
    return (
      <div className="bg-slate-900/80 border border-red-500/30 rounded-3xl p-8 text-center max-w-2xl mx-auto space-y-4 my-8 backdrop-blur-xl">
        <div className="w-14 h-14 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto text-red-400 border border-red-500/20">
          <AlertCircle className="w-7 h-7" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-white">Impossible d'accéder au calendrier</h3>
          <p className="text-slate-400 text-sm">{error}</p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            fetchParentStudentCalendar(studentId)
              .then(setData)
              .catch(e => setError(e.message))
              .finally(() => setLoading(false));
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl transition-all border border-slate-700/50"
        >
          <RefreshCw className="w-4 h-4" />
          Réessayer
        </button>
      </div>
    );
  }

  const eventsList = filteredEvents;
  const totalEvents = data?.summary.total_events || 0;

  return (
    <div className="space-y-6">
      {/* En-tête principal du calendrier */}
      <div className="bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-slate-800/80 rounded-3xl p-6 md:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl -z-10 pointer-events-none"></div>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
                <CalendarIcon className="w-6 h-6" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Calendrier Scolaire Officiel</h2>
                <p className="text-slate-400 text-sm">
                  {data?.student_name} • {data?.class_name} • Année {data?.academic_year_name}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-4 py-2 bg-slate-800/80 border border-slate-700/50 rounded-2xl text-xs font-medium text-slate-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>{totalEvents} Événement{totalEvents > 1 ? 's' : ''} publié{totalEvents > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        {/* Filtres par type */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-400 mr-2 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            Filtrer par :
          </span>
          {[
            { id: 'all', label: 'Tous les événements' },
            { id: 'academic', label: 'Académique' },
            { id: 'sports', label: 'Sport & Culture' },
            { id: 'meeting', label: 'Réunions' },
            { id: 'holiday', label: 'Vacances' },
            { id: 'event', label: 'Autres' },
          ].map(filter => (
            <button
              key={filter.id}
              onClick={() => setSelectedType(filter.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
                selectedType === filter.id
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'bg-slate-800/40 text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. État Liste d'événements vide */}
      {eventsList.length === 0 ? (
        <div className="bg-slate-900/60 border border-slate-800/60 rounded-3xl p-12 text-center space-y-4 backdrop-blur-xl">
          <div className="w-16 h-16 bg-slate-800/80 rounded-3xl flex items-center justify-center mx-auto text-slate-500 border border-slate-700/40">
            <Info className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-lg font-medium text-slate-200">
              {selectedType !== 'all' 
                ? 'Aucun événement ne correspond au filtre sélectionné.'
                : 'Aucun événement scolaire n’est actuellement publié.'}
            </h3>
            <p className="text-slate-500 text-sm">
              {selectedType !== 'all' 
                ? 'Essayez de sélectionner un autre type ou d’afficher tous les événements.'
                : 'Les événements officiels de l’établissement seront affichés dès leur publication.'}
            </p>
          </div>
          {selectedType !== 'all' && (
            <button
              onClick={() => setSelectedType('all')}
              className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-medium border border-slate-700/50 transition-all"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        /* 4. Grille des événements */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {eventsList.map(item => {
            const badge = getEventTypeBadge(item.event_type);
            const BadgeIcon = badge.icon;

            return (
              <div
                key={item.id}
                className="bg-slate-900/70 border border-slate-800/80 hover:border-slate-700/90 rounded-3xl p-6 space-y-4 transition-all hover:translate-y-[-2px] hover:shadow-xl backdrop-blur-md group relative overflow-hidden"
              >
                {/* Barre latérale décorative selon le type */}
                <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${badge.className.split(' ')[0]}`}></div>

                <div className="flex justify-between items-start gap-3 pl-2">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${badge.className}`}>
                    <BadgeIcon className="w-3.5 h-3.5" />
                    {badge.label}
                  </span>

                  {item.is_all_day && (
                    <span className="px-2.5 py-0.5 bg-slate-800 text-slate-400 text-[11px] font-medium rounded-md border border-slate-700/50">
                      Toute la journée
                    </span>
                  )}
                </div>

                <div className="pl-2 space-y-2">
                  <h3 className="text-lg font-semibold text-white group-hover:text-emerald-400 transition-colors">
                    {item.title}
                  </h3>

                  {item.description && (
                    <p className="text-slate-400 text-sm line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  )}
                </div>

                <div className="pl-2 pt-2 border-t border-slate-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-400">
                  <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                    <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{formatDateRange(item.start_date, item.end_date, item.is_all_day)}</span>
                  </div>

                  {item.location && (
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate max-w-[180px]">{item.location}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
